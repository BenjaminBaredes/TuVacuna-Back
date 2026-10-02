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

const loginPaciente = async (req, res) => {
    const { mail, password } = req.body;

    if (!mail || !password) {
        return res.status(400).json({ mensaje: "Mail y contraseña son obligatorios" });
    }

    try {
        // 1. Buscar el paciente por mail
        const result = await query(
            "SELECT id_paciente, password FROM paciente WHERE mail = $1",
            [mail]
        );
        const paciente = result.rows[0];

        // 2. Si no existe, o no tiene contraseña (como los de prueba), error
        if (!paciente || !paciente.password) {
            return res.status(401).json({ mensaje: "Mail o contraseña incorrectos" });
        }

        // 3. Comparar la contraseña con el hash guardado
        const coincide = await bcrypt.compare(password, paciente.password);
        if (!coincide) {
            return res.status(401).json({ mensaje: "Mail o contraseña incorrectos" });
        }

        // 4. Crear el token con el id y el rol
        const token = jwt.sign(
            { id: paciente.id_paciente, rol: "paciente" },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.json({ token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { registrarsePaciente, registrarseMedico, loginPaciente };