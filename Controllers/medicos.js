import { query } from "../db.js";

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
const getMisPacientes = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos tienen pacientes" });
    }

    try {
        // 1. Los pacientes que aceptaron a este médico
        const pacientesResult = await query(
            `SELECT p.id_paciente, p.nombre, p.apellido, p.dni, p.obra_social,
                    TO_CHAR(p.fecha_de_nacimiento, 'YYYY-MM-DD') AS fecha_de_nacimiento
             FROM tiene_medico tm
             JOIN paciente p ON p.id_paciente = tm.id_paciente
             WHERE tm.id_medico = $1 AND tm.estado = 'aceptado'
             ORDER BY p.apellido, p.nombre`,
            [id]
        );
        const pacientes = pacientesResult.rows;

        if (pacientes.length === 0) {
            return res.json([]);
        }

        const ids = pacientes.map((p) => p.id_paciente);

        // 2. Las comorbilidades de todos juntos (una sola consulta)
        const comorbResult = await query(
            `SELECT tc.id_paciente, c.id_comorbilidad, c.nombre
             FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = ANY($1::int[])
             ORDER BY c.nombre`,
            [ids]
        );

        // 3. Las dosis aplicadas de todos juntos (una sola consulta)
        const dosisResult = await query(
            `SELECT ca.id_paciente, po.id, v.nombre,
                    TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD') AS fecha_de_aplicacion
             FROM carnet ca
             JOIN posee po ON po.id_carnet = ca.id_carnet
             JOIN vacunas v ON v.id_vacuna = po.id_vacuna
             WHERE ca.id_paciente = ANY($1::int[])
             ORDER BY po.fecha_de_aplicacion DESC NULLS LAST`,
            [ids]
        );

        // 4. Repartir cada cosa en su paciente.
        //    porId es un índice: con el id del paciente lo encontramos al instante.
        const porId = {};
        for (const paciente of pacientes) {
            paciente.comorbilidades = [];
            paciente.dosis = [];
            porId[paciente.id_paciente] = paciente;
        }

        for (const fila of comorbResult.rows) {
            porId[fila.id_paciente].comorbilidades.push({
                id_comorbilidad: fila.id_comorbilidad,
                nombre: fila.nombre,
            });
        }

        for (const fila of dosisResult.rows) {
            porId[fila.id_paciente].dosis.push({
                id: fila.id,
                nombre: fila.nombre,
                estado: "aplicada",
                fecha_de_aplicacion: fila.fecha_de_aplicacion,
            });
        }

        res.json(pacientes);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { buscarMedicos, getMisPacientes };