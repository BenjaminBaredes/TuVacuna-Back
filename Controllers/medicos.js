import { query } from "../db.js";
import { calcularPendientes, estadoGeneral } from "./calculoVacunas.js";

const buscarMedicos = async (req, res) => {
    const { rol } = req.usuario;

    // Solo los pacientes buscan médicos
    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes pueden buscar médicos" });
    }

    // 1. Leer el texto de búsqueda (?busqueda=...)
    const texto = String(req.query.busqueda ?? "").trim();
    if (texto.length < 2) {
        return res.status(400).json({ mensaje: "La búsqueda debe tener al menos 2 caracteres" });
    }

    // 2. Separar en palabras (máximo 5)
    const palabras = texto.split(/\s+/).slice(0, 5);

    // 3. Armar una condición por cada palabra
    const condiciones = [];
    const valores = [];

    for (const palabra of palabras) {
        // Escapar los comodines de SQL (% _ \) para que se busquen como texto normal
        const segura = palabra.replace(/[\\%_]/g, "\\$&");
        valores.push(`%${segura}%`);

        const n = valores.length;
        condiciones.push(
            `(nombre ILIKE $${n} OR apellido ILIKE $${n} OR especialidad ILIKE $${n} OR institucion ILIKE $${n})`
        );
    }

    try {
        // 4. Cada palabra tiene que aparecer en al menos uno de los cuatro campos
        const result = await query(
            `SELECT id_medico, nombre, apellido, especialidad, institucion, matricula
             FROM medico
             WHERE ${condiciones.join(" AND ")}
             ORDER BY apellido, nombre
             LIMIT 20`,
            valores
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/medico/pacientes
// Lista liviana para la tabla "Mis pacientes": datos básicos, la última vacuna y el estado.
const getMisPacientes = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos tienen pacientes" });
    }

    try {
        // LATERAL busca, para cada paciente, su dosis aplicada más reciente
        const result = await query(
            `SELECT p.id_paciente, p.nombre, p.apellido, p.dni,
                    (p.fecha_de_nacimiento IS NOT NULL) AS tiene_nacimiento,
                    u.id_vacuna AS ultima_id_vacuna, u.nombre AS ultima_nombre,
                    u.dosis AS ultima_dosis, u.fecha_de_aplicacion AS ultima_fecha
             FROM tiene_medico tm
             JOIN paciente p ON p.id_paciente = tm.id_paciente
             LEFT JOIN LATERAL (
                 SELECT v.id_vacuna, v.nombre, v.dosis,
                        TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD') AS fecha_de_aplicacion
                 FROM carnet ca
                 JOIN posee po ON po.id_carnet = ca.id_carnet
                 JOIN vacunas v ON v.id_vacuna = po.id_vacuna
                 WHERE ca.id_paciente = p.id_paciente
                 ORDER BY po.fecha_de_aplicacion DESC NULLS LAST, po.id DESC
                 LIMIT 1
             ) u ON TRUE
             WHERE tm.id_medico = $1 AND tm.estado = 'aceptado'
             ORDER BY p.apellido, p.nombre`,
            [id]
        );

        // Estado de cada paciente según el cálculo con el Calendario Nacional
        const estados = await Promise.all(
            result.rows.map(async (fila) =>
                fila.tiene_nacimiento ? estadoGeneral(await calcularPendientes(fila.id_paciente)) : null
            )
        );

        res.json(
            result.rows.map((fila, i) => ({
                id_paciente: fila.id_paciente,
                nombre: fila.nombre,
                apellido: fila.apellido,
                dni: fila.dni,
                ultima_vacuna: fila.ultima_id_vacuna
                    ? {
                          id_vacuna: fila.ultima_id_vacuna,
                          nombre: fila.ultima_nombre,
                          dosis: fila.ultima_dosis,
                          fecha_de_aplicacion: fila.ultima_fecha,
                      }
                    : null,
                // "atrasada": alguna dosis del calendario atrasada
                // "proxima":  le toca una dosis del calendario en los próximos 30 días
                // "al-dia":   ninguna de las dos
                // null:       sin fecha de nacimiento cargada, no se puede evaluar
                estado: estados[i],
            }))
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/medico/pacientes/:id
// Detalle de un paciente que aceptó al médico: perfil, comorbilidades y dosis aplicadas.
const getPacienteDetalle = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos tienen pacientes" });
    }

    const idPaciente = Number(req.params.id);
    if (!Number.isInteger(idPaciente)) {
        return res.status(400).json({ mensaje: "ID de paciente inválido" });
    }

    try {
        // 1. El paciente, solo si aceptó a este médico
        const pacienteResult = await query(
            `SELECT p.id_paciente, p.nombre, p.apellido, p.dni,
                    TO_CHAR(p.fecha_de_nacimiento, 'YYYY-MM-DD') AS fecha_de_nacimiento,
                    os.nombre AS obra_social
             FROM tiene_medico tm
             JOIN paciente p ON p.id_paciente = tm.id_paciente
             LEFT JOIN obra_social os ON os.id_obra_social = p.id_obra_social
             WHERE tm.id_medico = $1 AND tm.id_paciente = $2 AND tm.estado = 'aceptado'`,
            [id, idPaciente]
        );

        if (pacienteResult.rows.length === 0) {
            return res.status(404).json({ mensaje: "Paciente no encontrado" });
        }

        // 2. Sus comorbilidades
        const comorbResult = await query(
            `SELECT c.id_comorbilidad, c.nombre
             FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = $1
             ORDER BY c.nombre`,
            [idPaciente]
        );

        // 3. Sus dosis aplicadas, de la más reciente a la más antigua
        const dosisResult = await query(
            `SELECT po.id, v.id_vacuna, v.nombre, v.dosis, 'aplicada' AS estado,
                    TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD') AS fecha_de_aplicacion
             FROM carnet ca
             JOIN posee po ON po.id_carnet = ca.id_carnet
             JOIN vacunas v ON v.id_vacuna = po.id_vacuna
             WHERE ca.id_paciente = $1
             ORDER BY po.fecha_de_aplicacion DESC NULLS LAST, po.id DESC`,
            [idPaciente]
        );

        res.json({
            ...pacienteResult.rows[0],
            comorbilidades: comorbResult.rows,
            dosis: dosisResult.rows,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { buscarMedicos, getMisPacientes, getPacienteDetalle };