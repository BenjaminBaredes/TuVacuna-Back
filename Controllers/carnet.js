import { query } from "../db.js";
import { tieneAcceso } from "./familia.js";
import { calcularPendientes } from "./Calculovacunas.js";

// Función auxiliar: arma el carnet de un paciente.
// Primero la sección "PENDIENTES" (lo que le falta, calculado con el Calendario Nacional),
// después las dosis aplicadas agrupadas por año.
// No comprueba permisos: cada endpoint que la usa lo hace antes.
const armarCarnet = async (idPaciente) => {
    const result = await query(
        // id es el de la fila del carnet; id_vacuna es el de la dosis (el que pide POST /api/turnos)
        `SELECT po.id, v.id_vacuna, v.nombre, v.dosis, v.en_calendario, 'aplicada' AS estado,
                TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD') AS fecha_de_aplicacion,
                po.lote, po.marca, po.lugar
         FROM carnet c
         JOIN posee po ON po.id_carnet = c.id_carnet
         JOIN vacunas v ON v.id_vacuna = po.id_vacuna
         WHERE c.id_paciente = $1
         ORDER BY po.fecha_de_aplicacion DESC NULLS LAST`,
        [idPaciente]
    );

    const secciones = [];

    // Pendientes, atrasadas y recomendadas. Tienen id null porque todavía no están en el carnet.
    const pendientes = await calcularPendientes(idPaciente);
    if (pendientes.length > 0) {
        secciones.push({
            grupo: "PENDIENTES",
            esPendiente: true,
            dosis: pendientes.map((p) => ({
                id: null,
                id_vacuna: p.id_vacuna,
                nombre: p.nombre,
                dosis: p.dosis,
                en_calendario: p.en_calendario,
                estado: p.estado,
                fecha_recomendada: p.fecha_recomendada,
                fecha_de_aplicacion: null,
                lote: null,
                marca: null,
                lugar: null,
            })),
        });
    }

    for (const fila of result.rows) {
        let anio = "Sin fecha";
        if (fila.fecha_de_aplicacion) {
            anio = fila.fecha_de_aplicacion.slice(0, 4);
        }

        const ultima = secciones[secciones.length - 1];

        if (!ultima || ultima.grupo !== anio) {
            secciones.push({ grupo: anio, esPendiente: false, dosis: [fila] });
        } else {
            ultima.dosis.push(fila);
        }
    }

    return secciones;
};

// Función auxiliar: valida y guarda una dosis en el carnet de idPaciente.
// No comprueba permisos: cada endpoint que la usa lo hace antes.
const guardarDosis = async (idPaciente, body, res) => {
    // id_vacuna identifica una dosis concreta (por ejemplo "Quíntuple (pentavalente)" + "2ª dosis (4 meses)")
    const { id_vacuna, fecha_de_aplicacion, lote, marca, lugar } = body ?? {};

    // 1. Todos los campos son obligatorios
    if (!id_vacuna || !fecha_de_aplicacion || !lote || !marca || !lugar) {
        return res.status(400).json({
            mensaje: "Faltan datos obligatorios (id_vacuna, fecha_de_aplicacion, lote, marca, lugar)"
        });
    }

    // 2. El id de la vacuna tiene que ser un número entero
    if (!Number.isInteger(Number(id_vacuna))) {
        return res.status(400).json({ mensaje: "id_vacuna inválido" });
    }

    // 3. La fecha tiene que tener formato AAAA-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_de_aplicacion)) {
        return res.status(400).json({ mensaje: "La fecha debe tener formato AAAA-MM-DD" });
    }

    // 4. Lote, marca y lugar no pueden ser solo espacios
    const loteLimpio = String(lote).trim();
    const marcaLimpia = String(marca).trim();
    const lugarLimpio = String(lugar).trim();

    if (!loteLimpio || !marcaLimpia || !lugarLimpio) {
        return res.status(400).json({ mensaje: "Lote, marca y lugar no pueden estar vacíos" });
    }

    try {
        // 5. Buscar la vacuna (con su dosis)
        const vacuna = await query(
            "SELECT id_vacuna, nombre, dosis, en_calendario FROM vacunas WHERE id_vacuna = $1",
            [Number(id_vacuna)]
        );
        if (vacuna.rows.length === 0) {
            return res.status(404).json({ mensaje: "Vacuna no encontrada" });
        }

        // 6. Buscar el carnet del paciente
        const carnet = await query(
            "SELECT id_carnet FROM carnet WHERE id_paciente = $1",
            [idPaciente]
        );
        if (carnet.rows.length === 0) {
            return res.status(404).json({ mensaje: "El paciente no tiene carnet" });
        }

        // 7. Guardar la dosis
        const result = await query(
            `INSERT INTO posee (id_carnet, id_vacuna, fecha_de_aplicacion, lote, marca, lugar)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
                carnet.rows[0].id_carnet,
                vacuna.rows[0].id_vacuna,
                fecha_de_aplicacion,
                loteLimpio,
                marcaLimpia,
                lugarLimpio,
            ]
        );

        // 8. Devolver la dosis con el mismo formato que GET /api/carnet
        res.status(201).json({
            id: result.rows[0].id,
            id_vacuna: vacuna.rows[0].id_vacuna,
            nombre: vacuna.rows[0].nombre,
            dosis: vacuna.rows[0].dosis,
            en_calendario: vacuna.rows[0].en_calendario,
            estado: "aplicada",
            fecha_de_aplicacion,
            lote: loteLimpio,
            marca: marcaLimpia,
            lugar: lugarLimpio,
        });
    } catch (err) {
        // 22007 y 22008: fecha que no existe, como 2025-13-45
        if (err.code === "22007" || err.code === "22008") {
            return res.status(400).json({ mensaje: "Fecha inválida" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/carnet — el paciente ve su propio carnet
const getCarnet = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen carnet" });
    }

    try {
        res.json(await armarCarnet(id));
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/carnet/:idPaciente — el carnet de otra persona. Pueden verlo:
//   - un médico, si el paciente aceptó su solicitud
//   - un paciente, si esa persona aceptó su solicitud de familia
const getCarnetDePaciente = async (req, res) => {
    const { id, rol } = req.usuario;

    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isInteger(idPaciente)) {
        return res.status(400).json({ mensaje: "ID de paciente inválido" });
    }

    try {
        let permitido = false;

        if (rol === "medico") {
            const vinculo = await query(
                `SELECT 1 FROM tiene_medico
                 WHERE id_paciente = $1 AND id_medico = $2 AND estado = 'aceptado'`,
                [idPaciente, id]
            );
            permitido = vinculo.rows.length > 0;
        } else if (rol === "paciente") {
            permitido = await tieneAcceso(id, idPaciente);
        }

        if (!permitido) {
            return res.status(404).json({ mensaje: "Paciente no encontrado" });
        }

        res.json(await armarCarnet(idPaciente));
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// POST /api/carnet/dosis — el paciente carga una dosis ya aplicada en su carnet
const postDosis = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen carnet" });
    }

    return guardarDosis(id, req.body, res);
};

// POST /api/carnet/:idPaciente/dosis — el paciente carga una dosis en el carnet de un familiar
const postDosisFamiliar = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes pueden cargar dosis" });
    }

    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isInteger(idPaciente)) {
        return res.status(400).json({ mensaje: "ID de paciente inválido" });
    }

    try {
        if (!(await tieneAcceso(id, idPaciente))) {
            return res.status(404).json({ mensaje: "Paciente no encontrado" });
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ mensaje: "Error interno" });
    }

    return guardarDosis(idPaciente, req.body, res);
};

export default { getCarnet, getCarnetDePaciente, postDosis, postDosisFamiliar };