import { query } from "../db.js";

// GET /api/obras-sociales — público (sin token): se usa en la pantalla de registro
const getObrasSociales = async (_, res) => {
    try {
        const result = await query(
            "SELECT id_obra_social, nombre FROM obra_social ORDER BY nombre"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getObrasSociales };