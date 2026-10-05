import { query } from "../db.js";

const getMe = async (req, res) => {
    // Estos datos los dejó el middleware
    const { id, rol } = req.usuario;

    // Según el rol, se busca en una tabla u otra
    const tablas = {
        paciente: { tabla: "paciente", id: "id_paciente" },
        medico: { tabla: "medico", id: "id_medico" },
    };
    const config = tablas[rol];

    if (!config) {
        return res.status(400).json({ mensaje: "Rol inválido en el token" });
    }

    try {
        const result = await query(
            `SELECT ${config.id} AS id, nombre FROM ${config.tabla} WHERE ${config.id} = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Usuario no encontrado" });
        }

        res.json({ ...result.rows[0], rol });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getMe };