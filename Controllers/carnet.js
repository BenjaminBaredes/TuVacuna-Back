import { query } from "../db.js";

const getCarnet = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen carnet" });
    }

    try {
        const result = await query(
            `SELECT po.id, v.nombre,
                    TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD') AS fecha_de_aplicacion,
                    po.lote, po.marca, po.lugar
             FROM carnet c
             JOIN posee po ON po.id_carnet = c.id_carnet
             JOIN vacunas v ON v.id_vacuna = po.id_vacuna
             WHERE c.id_paciente = $1
             ORDER BY po.fecha_de_aplicacion DESC NULLS LAST`,
            [id]
        );

        // Agrupar por año (las filas ya vienen ordenadas por fecha)
        const secciones = [];

        for (const fila of result.rows) {
            // 1. Sacar el año de la fecha
            let anio = "Sin fecha";
            if (fila.fecha_de_aplicacion) {
                anio = fila.fecha_de_aplicacion.slice(0, 4);
            }

            // 2. Mirar la última sección creada
            const ultima = secciones[secciones.length - 1];

            // 3. Si no hay sección o es de otro año, abrir una nueva
            if (!ultima || ultima.grupo !== anio) {
                secciones.push({ grupo: anio, esPendiente: false, dosis: [fila] });
            } else {
                // 4. Si es el mismo año, agregar la dosis a esa sección
                ultima.dosis.push(fila);
            }
        }

        res.json(secciones);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

const postDosis = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen carnet" });
    }

    const { id_vacuna, fecha_de_aplicacion, lote, marca, lugar } = req.body;

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
        // 5. Buscar la vacuna
        const vacuna = await query(
            "SELECT id_vacuna, nombre FROM vacunas WHERE id_vacuna = $1",
            [Number(id_vacuna)]
        );
        if (vacuna.rows.length === 0) {
            return res.status(404).json({ mensaje: "Vacuna no encontrada" });
        }

        // 6. Buscar el carnet del paciente
        const carnet = await query(
            "SELECT id_carnet FROM carnet WHERE id_paciente = $1",
            [id]
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
            nombre: vacuna.rows[0].nombre,
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

export default { getCarnet, postDosis };