import { query } from "../db.js";

const getMe = async (req, res) => {
    const { id, rol } = req.usuario;

    try {
        let result;

        if (rol === "paciente") {
            result = await query(
                `SELECT id_paciente AS id, nombre, apellido, dni, mail, obra_social, sexo,
                        TO_CHAR(fecha_de_nacimiento, 'YYYY-MM-DD') AS fecha_de_nacimiento
                 FROM paciente
                 WHERE id_paciente = $1`,
                [id]
            );
        } else if (rol === "medico") {
            result = await query(
                `SELECT id_medico AS id, nombre, apellido, dni, mail,
                        matricula, especialidad, institucion
                 FROM medico
                 WHERE id_medico = $1`,
                [id]
            );
        } else {
            return res.status(400).json({ mensaje: "Rol inválido en el token" });
        }

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