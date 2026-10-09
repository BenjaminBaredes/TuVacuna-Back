import { query } from "../db.js";

const getVacunas = async (_, res) => {
    try {
        const result = await query(
            "SELECT id_vacuna, nombre FROM vacunas WHERE nombre IS NOT NULL ORDER BY nombre"
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getVacunas };