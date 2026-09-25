import { query } from "../db.js";

/**
 * @param {import('express').Request} _
 * @param {import('express').Response} res
 */

const getPacientes = async (_, res) => {
    const result = await query("SELECT * FROM paciente");
    res.json(result.rows);
};

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getPaciente = async (req, res) => {
    const result = await query(
        "SELECT * FROM paciente WHERE id_paciente = $1",
        [req.params.id]
    );

    console.log(result.rows);


    if (result.rows.length === 0) {
        return res.status(404).json({
            mensaje: "Paciente no encontrado"
        });
    }

    res.json(result.rows[0]);
};
const pacientes = {
    getPacientes,
    getPaciente
};

export default pacientes;