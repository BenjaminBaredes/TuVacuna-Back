import { pool, query } from "../db.js";

// El paciente ve sus comorbilidades
const getMisComorbilidades = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen comorbilidades" });
    }

    try {
        const result = await query(
            `SELECT c.id_comorbilidad, c.nombre
             FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = $1
             ORDER BY c.nombre`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// El paciente reemplaza su lista completa de comorbilidades
const putMisComorbilidades = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen comorbilidades" });
    }

    const { comorbilidades } = req.body;

    if (!Array.isArray(comorbilidades)) {
        return res.status(400).json({ mensaje: "comorbilidades debe ser una lista de IDs" });
    }
    for (const idComorbilidad of comorbilidades) {
        if (!Number.isInteger(idComorbilidad)) {
            return res.status(400).json({ mensaje: "Cada comorbilidad debe ser un ID numérico" });
        }
    }

    // Una conexión propia para poder usar una transacción
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        await client.query(
            "DELETE FROM tiene_comorbilidad WHERE id_paciente = $1",
            [id]
        );

        await client.query(
            `INSERT INTO tiene_comorbilidad (id_paciente, id_comorbilidad)
             SELECT DISTINCT $1::int, c FROM unnest($2::int[]) AS c`,
            [id, comorbilidades]
        );

        await client.query("COMMIT");

        const result = await client.query(
            `SELECT c.id_comorbilidad, c.nombre
             FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = $1
             ORDER BY c.nombre`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        await client.query("ROLLBACK");

        if (err.code === "23503") {
            return res.status(400).json({ mensaje: "Alguna de las comorbilidades no existe" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    } finally {
        client.release();
    }
};

// El médico ve las comorbilidades de un paciente que ya aceptó su solicitud
const getComorbilidadesDePaciente = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "No autorizado" });
    }

    const idPaciente = Number(req.params.idPaciente);
    if (!Number.isInteger(idPaciente)) {
        return res.status(400).json({ mensaje: "ID de paciente inválido" });
    }

    try {
        const vinculo = await query(
            `SELECT 1 FROM tiene_medico
             WHERE id_paciente = $1 AND id_medico = $2 AND estado = 'aceptado'`,
            [idPaciente, id]
        );

        if (vinculo.rows.length === 0) {
            return res.status(404).json({ mensaje: "Paciente no encontrado" });
        }

        const result = await query(
            `SELECT c.id_comorbilidad, c.nombre
             FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = $1
             ORDER BY c.nombre`,
            [idPaciente]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getMisComorbilidades, putMisComorbilidades, getComorbilidadesDePaciente };