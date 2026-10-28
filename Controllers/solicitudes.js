import { query } from "../db.js";

// El paciente envía una solicitud a un médico
const enviarSolicitud = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes pueden enviar solicitudes" });
    }

    // 1. El id del médico viene en la URL: /api/medicos/:id/solicitud
    const idMedico = Number(req.params.id);
    if (!Number.isInteger(idMedico)) {
        return res.status(400).json({ mensaje: "ID de médico inválido" });
    }

    try {
        // 2. Crear la solicitud. Si ya existía, no hace nada (ON CONFLICT)
        const result = await query(
            `INSERT INTO tiene_medico (id_paciente, id_medico, estado)
             VALUES ($1, $2, 'pendiente')
             ON CONFLICT (id_paciente, id_medico) DO NOTHING
             RETURNING id`,
            [id, idMedico]
        );

        // 3. Si no devolvió ninguna fila, es porque ya existía
        if (result.rows.length === 0) {
            return res.status(409).json({
                mensaje: "Ya enviaste una solicitud a este médico o ya te atiende"
            });
        }

        res.status(201).json({ id: result.rows[0].id, estado: "pendiente" });
    } catch (err) {
        // 23503: el médico no existe (falla la clave foránea)
        if (err.code === "23503") {
            return res.status(404).json({ mensaje: "Médico no encontrado" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// El médico ve las solicitudes pendientes que le llegaron
const getSolicitudesRecibidas = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos reciben solicitudes" });
    }

    try {
        const result = await query(
            `SELECT tm.id, p.nombre, p.apellido,
            EXTRACT(YEAR FROM age(p.fecha_de_nacimiento))::int AS edad
            FROM tiene_medico tm
            JOIN paciente p ON p.id_paciente = tm.id_paciente
            WHERE tm.id_medico = $1 AND tm.estado = 'pendiente'
            ORDER BY tm.id DESC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};
// El médico acepta una solicitud pendiente
const aceptarSolicitud = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos pueden aceptar solicitudes" });
    }

    const idSolicitud = Number(req.params.id);
    if (!Number.isInteger(idSolicitud)) {
        return res.status(400).json({ mensaje: "ID de solicitud inválido" });
    }

    try {
        const result = await query(
            `UPDATE tiene_medico
             SET estado = 'aceptado'
             WHERE id = $1 AND id_medico = $2 AND estado = 'pendiente'
             RETURNING id`,
            [idSolicitud, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Solicitud no encontrada" });
        }

        res.json({ id: result.rows[0].id, estado: "aceptado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// El médico rechaza una solicitud pendiente (se borra)
const rechazarSolicitud = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos pueden rechazar solicitudes" });
    }

    const idSolicitud = Number(req.params.id);
    if (!Number.isInteger(idSolicitud)) {
        return res.status(400).json({ mensaje: "ID de solicitud inválido" });
    }

    try {
        const result = await query(
            `DELETE FROM tiene_medico
             WHERE id = $1 AND id_medico = $2 AND estado = 'pendiente'
             RETURNING id`,
            [idSolicitud, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Solicitud no encontrada" });
        }

        res.json({ id: result.rows[0].id, estado: "rechazado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};
// El paciente ve sus médicos: los aceptados y las solicitudes pendientes
const getMisMedicos = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen médicos" });
    }

    try {
        const result = await query(
            `SELECT tm.id, tm.estado, m.id_medico, m.nombre, m.apellido,
                    m.especialidad, m.institucion
             FROM tiene_medico tm
             JOIN medico m ON m.id_medico = tm.id_medico
             WHERE tm.id_paciente = $1
             ORDER BY tm.estado, m.apellido`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// El paciente cancela una solicitud pendiente o le quita el acceso a un médico
const quitarMedico = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes pueden hacer esto" });
    }

    const idVinculo = Number(req.params.id);
    if (!Number.isInteger(idVinculo)) {
        return res.status(400).json({ mensaje: "ID inválido" });
    }

    try {
        const result = await query(
            "DELETE FROM tiene_medico WHERE id = $1 AND id_paciente = $2 RETURNING id",
            [idVinculo, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Vínculo no encontrado" });
        }

        res.json({ id: result.rows[0].id, estado: "eliminado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default {
    enviarSolicitud, getSolicitudesRecibidas, aceptarSolicitud, rechazarSolicitud,
    getMisMedicos, quitarMedico,
};