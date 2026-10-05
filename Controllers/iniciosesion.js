import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db.js";

const registrarsePaciente = async (req, res) => {
    const { dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo, password } = req.body;

    if (!dni || !nombre || !apellido || !fecha_de_nacimiento || !mail || !password) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        const result = await query(
            `INSERT INTO paciente (dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo, password)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id_paciente, dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo`,
            [dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo, hash]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe un paciente con ese DNI o mail" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

const registrarseMedico = async (req, res) => {
    const { dni, nombre, apellido, matricula, mail, password } = req.body;

    if (!dni || !nombre || !apellido || !matricula || !mail || !password) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios" });
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        const result = await query(
            `INSERT INTO medico (dni, nombre, apellido, matricula, mail, password)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id_medico, dni, nombre, apellido, matricula, mail`,
            [dni, nombre, apellido, matricula, mail, hash]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe un médico con ese DNI, mail o matrícula" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

const registro = (req, res) => {
    const { rol } = req.body;

    if (rol === "paciente") return registrarsePaciente(req, res);
    if (rol === "medico") return registrarseMedico(req, res);

    res.status(400).json({ mensaje: "El rol debe ser 'paciente' o 'medico'" });
};

const login = async (req, res) => {
    const { mail, password, rol } = req.body;

    if (!mail || !password || !rol) {
        return res.status(400).json({ mensaje: "Mail, contraseña y rol son obligatorios" });
    }

    const tablas = {
        paciente: { tabla: "paciente", id: "id_paciente" },
        medico: { tabla: "medico", id: "id_medico" },
    };
    const config = tablas[rol];

    if (!config) {
        return res.status(400).json({ mensaje: "El rol debe ser 'paciente' o 'medico'" });
    }

    try {
        const result = await query(
            `SELECT ${config.id} AS id, password FROM ${config.tabla} WHERE mail = $1`,
            [mail]
        );
        const usuario = result.rows[0];

        if (!usuario || !usuario.password) {
            return res.status(401).json({ mensaje: "Mail o contraseña incorrectos" });
        }

        const coincide = await bcrypt.compare(password, usuario.password);
        if (!coincide) {
            return res.status(401).json({ mensaje: "Mail o contraseña incorrectos" });
        }

        const token = jwt.sign(
            { id: usuario.id, rol },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.json({ token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { registro, login };