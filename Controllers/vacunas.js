import { query } from "../db.js";

const getVacunas = async (_, res) => {
    try {
        const result = await query(
            `SELECT id_vacuna, nombre, dosis, en_calendario
             FROM vacunas
             ORDER BY en_calendario DESC, nombre, id_vacuna`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getVacunas };