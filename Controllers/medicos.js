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
const getMPacientes = async (req, res) => {
    const { id, rol } = req.usuario;

    if (rol !== "medico") {
        return res.status(403).json({ mensaje: "Solo los médicos tienen pacientes" });
    }

    try {
        // Solo los pacientes que ya aceptaron
        const result = await query(
            `SELECT p.id_paciente, p.nombre, p.apellido, p.dni,
                    TO_CHAR(p.fecha_de_nacimiento, 'YYYY-MM-DD') AS fecha_de_nacimiento
             FROM tiene_medico tm
             JOIN paciente p ON p.id_paciente = tm.id_paciente
             WHERE tm.id_medico = $1 AND tm.estado = 'aceptado'
             ORDER BY p.apellido, p.nombre`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};
export default { buscarMedicos, getMPacientes };