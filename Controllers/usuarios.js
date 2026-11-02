import { query } from "../db.js";

const getMe = async (req, res) => {
    const { id, rol } = req.usuario;

    try {
        let result;

        if (rol === "paciente") {
            // La obra social se busca en el catálogo: se devuelve su id y su nombre
            result = await query(
                `SELECT p.id_paciente AS id, p.nombre, p.apellido, p.dni, p.mail,
                        p.id_obra_social, os.nombre AS obra_social, p.sexo,
                        TO_CHAR(p.fecha_de_nacimiento, 'YYYY-MM-DD') AS fecha_de_nacimiento
                 FROM paciente p
                 LEFT JOIN obra_social os ON os.id_obra_social = p.id_obra_social
                 WHERE p.id_paciente = $1`,
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