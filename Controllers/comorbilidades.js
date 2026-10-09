import { query } from "../db.js";

const getComorbilidades = async (_, res) => {
    try {
        const result = await query(
            "SELECT id_comorbilidad, nombre FROM comorbilidades ORDER BY nombre"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getComorbilidades };