import { query } from "../db.js";

const getCarnet = async (req, res) => {
    const { id, rol } = req.usuario;

    // Solo los pacientes tienen carnet
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

        // El frontend espera una lista de secciones.
        // Por ahora hay una sola: las dosis aplicadas.
        res.json([
            { grupo: "Aplicadas", esPendiente: false, dosis: result.rows }
        ]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getCarnet };