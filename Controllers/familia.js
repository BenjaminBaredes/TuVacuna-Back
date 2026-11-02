import { query } from "../db.js";

// Compara textos sin importar mayúsculas, tildes ni espacios de más
const NORMALIZAR = (expr) => `translate(lower(trim(${expr})), 'áéíóúüñ', 'aeiouun')`;

// ---------- Ayudas que usan también carnet.js y turnos.js ----------

// true si idSolicitante tiene acceso aceptado al carnet y calendario de idFamiliar
export const tieneAcceso = async (idSolicitante, idFamiliar) => {
    const result = await query(
        `SELECT 1 FROM vinculo_familiar
         WHERE id_solicitante = $1 AND id_familiar = $2 AND estado = 'aceptado'`,
        [idSolicitante, idFamiliar]
    );
    return result.rows.length > 0;
};

// El propio paciente y todos los familiares a los que tiene acceso
export const idsVisibles = async (idPaciente) => {
    const result = await query(
        `SELECT id_familiar FROM vinculo_familiar
         WHERE id_solicitante = $1 AND estado = 'aceptado'`,
        [idPaciente]
    );
    return [idPaciente, ...result.rows.map((fila) => fila.id_familiar)];
};

const soloPacientes = (req, res) => {
    if (req.usuario.rol !== "paciente") {
        res.status(403).json({ mensaje: "Solo los pacientes tienen familiares" });
        return false;
    }
    return true;
};

const iniciales = (nombre, apellido) =>
    `${String(nombre ?? "").trim().charAt(0)}${String(apellido ?? "").trim().charAt(0)}`.toUpperCase();

// ---------- Endpoints ----------

// GET /api/familia
// Para el selector de familiares: uno mismo primero, después los que aceptaron.
const getFamilia = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    try {
        const result = await query(
            `SELECT p.id_paciente, p.nombre, p.apellido, (p.id_paciente = $1) AS es_vos
             FROM paciente p
             WHERE p.id_paciente = $1
                OR p.id_paciente IN (SELECT id_familiar FROM vinculo_familiar
                                     WHERE id_solicitante = $1 AND estado = 'aceptado')
             ORDER BY es_vos DESC, p.apellido, p.nombre`,
            [id]
        );

        res.json(
            result.rows.map((fila) => ({
                id: fila.id_paciente,
                nombre: fila.nombre,
                apellido: fila.apellido,
                iniciales: iniciales(fila.nombre, fila.apellido),
                esVos: fila.es_vos,
            }))
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// POST /api/familia/solicitudes
// body: { mail, nombre, apellido } de la persona a la que se le pide acceso.
const enviarSolicitud = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;
    const { mail, nombre, apellido } = req.body ?? {};

    if (!String(mail ?? "").trim() || !String(nombre ?? "").trim() || !String(apellido ?? "").trim()) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios (mail, nombre, apellido)" });
    }

    try {
        // Los tres datos tienen que coincidir con el mismo paciente
        const persona = await query(
            `SELECT id_paciente FROM paciente
             WHERE lower(trim(mail)) = lower(trim($1))
               AND ${NORMALIZAR("nombre")} = ${NORMALIZAR("$2")}
               AND ${NORMALIZAR("apellido")} = ${NORMALIZAR("$3")}`,
            [String(mail), String(nombre), String(apellido)]
        );

        // Mismo mensaje si no existe el mail o si no coinciden el nombre o el apellido,
        // para no revelar qué mails están registrados
        if (persona.rows.length === 0) {
            return res.status(404).json({ mensaje: "No encontramos un paciente con esos datos" });
        }

        const idFamiliar = persona.rows[0].id_paciente;
        if (idFamiliar === id) {
            return res.status(400).json({ mensaje: "No podés enviarte una solicitud a vos mismo" });
        }

        const result = await query(
            `INSERT INTO vinculo_familiar (id_solicitante, id_familiar, estado)
             VALUES ($1, $2, 'pendiente')
             RETURNING id`,
            [id, idFamiliar]
        );

        res.status(201).json({ id: result.rows[0].id, estado: "pendiente" });
    } catch (err) {
        // 23505: ya hay una solicitud (pendiente o aceptada) hacia esa persona
        if (err.code === "23505") {
            return res.status(409).json({ mensaje: "Ya le enviaste una solicitud a esa persona, o ya tenés acceso" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/familia/solicitudes/recibidas — las que me pidieron a mí y todavía no contesté
const getSolicitudesRecibidas = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    try {
        const result = await query(
            `SELECT v.id, p.nombre, p.apellido, p.mail,
                    TO_CHAR(v.creado_en AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha
             FROM vinculo_familiar v
             JOIN paciente p ON p.id_paciente = v.id_solicitante
             WHERE v.id_familiar = $1 AND v.estado = 'pendiente'
             ORDER BY v.creado_en DESC`,
            [id]
        );

        res.json(
            result.rows.map((fila) => ({
                id: fila.id,
                solicitante: { nombre: fila.nombre, apellido: fila.apellido, mail: fila.mail },
                fecha: fila.fecha,
            }))
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/familia/solicitudes/enviadas — las que mandé y todavía no me contestaron
const getSolicitudesEnviadas = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    try {
        const result = await query(
            `SELECT v.id, p.nombre, p.apellido, p.mail
             FROM vinculo_familiar v
             JOIN paciente p ON p.id_paciente = v.id_familiar
             WHERE v.id_solicitante = $1 AND v.estado = 'pendiente'
             ORDER BY v.creado_en DESC`,
            [id]
        );

        res.json(
            result.rows.map((fila) => ({
                id: fila.id,
                destinatario: { nombre: fila.nombre, apellido: fila.apellido, mail: fila.mail },
                estado: "pendiente",
            }))
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// POST /api/familia/solicitudes/:id/aceptar — acepto: quien la mandó puede ver mi carnet y calendario
const aceptarSolicitud = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    const idSolicitud = Number(req.params.id);
    if (!Number.isInteger(idSolicitud)) {
        return res.status(400).json({ mensaje: "ID de solicitud inválido" });
    }

    try {
        const result = await query(
            `UPDATE vinculo_familiar SET estado = 'aceptado'
             WHERE id = $1 AND id_familiar = $2 AND estado = 'pendiente'
             RETURNING id`,
            [idSolicitud, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Solicitud no encontrada" });
        }
        res.json({ id: idSolicitud, estado: "aceptado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// POST /api/familia/solicitudes/:id/rechazar — se borra, así que se puede volver a enviar
const rechazarSolicitud = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    const idSolicitud = Number(req.params.id);
    if (!Number.isInteger(idSolicitud)) {
        return res.status(400).json({ mensaje: "ID de solicitud inválido" });
    }

    try {
        const result = await query(
            `DELETE FROM vinculo_familiar
             WHERE id = $1 AND id_familiar = $2 AND estado = 'pendiente'
             RETURNING id`,
            [idSolicitud, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Solicitud no encontrada" });
        }
        res.json({ id: idSolicitud, estado: "rechazado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/familia/acceso — quiénes pueden ver mi carnet y calendario
const getConAcceso = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    try {
        const result = await query(
            `SELECT v.id, p.id_paciente, p.nombre, p.apellido, p.mail
             FROM vinculo_familiar v
             JOIN paciente p ON p.id_paciente = v.id_solicitante
             WHERE v.id_familiar = $1 AND v.estado = 'aceptado'
             ORDER BY p.apellido, p.nombre`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// DELETE /api/familia/acceso/:id — le quito el acceso a alguien (solo el dueño del carnet puede)
const quitarAcceso = async (req, res) => {
    if (!soloPacientes(req, res)) return;
    const { id } = req.usuario;

    const idVinculo = Number(req.params.id);
    if (!Number.isInteger(idVinculo)) {
        return res.status(400).json({ mensaje: "ID inválido" });
    }

    try {
        const result = await query(
            `DELETE FROM vinculo_familiar
             WHERE id = $1 AND id_familiar = $2 AND estado = 'aceptado'
             RETURNING id`,
            [idVinculo, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Acceso no encontrado" });
        }
        res.json({ id: idVinculo, estado: "eliminado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default {
    getFamilia,
    enviarSolicitud,
    getSolicitudesRecibidas,
    getSolicitudesEnviadas,
    aceptarSolicitud,
    rechazarSolicitud,
    getConAcceso,
    quitarAcceso,
};