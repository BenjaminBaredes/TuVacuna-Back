import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { query } from "../db.js";

const registrarsePaciente = async (req, res) => {
    const { dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo, password, comorbilidades } = req.body;

    if (!dni || !nombre || !apellido || !fecha_de_nacimiento || !mail || !password) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios" });
    }

    // Las comorbilidades son opcionales. Si vienen, tienen que ser una lista de IDs numéricos.
    let idsComorbilidades = [];
    if (comorbilidades !== undefined) {
        if (!Array.isArray(comorbilidades)) {
            return res.status(400).json({ mensaje: "comorbilidades debe ser una lista de IDs" });
        }
        for (const idComorbilidad of comorbilidades) {
            if (!Number.isInteger(idComorbilidad)) {
                return res.status(400).json({ mensaje: "Cada comorbilidad debe ser un ID numérico" });
            }
        }
        idsComorbilidades = comorbilidades;
    }

    try {
        const hash = await bcrypt.hash(password, 10);

        const result = await query(
            `WITH nuevo AS (
                INSERT INTO paciente (dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo, password)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id_paciente, nombre
            ),
            carnet_nuevo AS (
                INSERT INTO carnet (id_paciente)
                SELECT id_paciente FROM nuevo
            ),
            comorbilidades_nuevas AS (
                INSERT INTO tiene_comorbilidad (id_paciente, id_comorbilidad)
                SELECT DISTINCT n.id_paciente, c
                FROM nuevo n, unnest($9::int[]) AS c
            )
            SELECT id_paciente, nombre FROM nuevo`,
            [dni, nombre, apellido, fecha_de_nacimiento, mail, obra_social, sexo, hash, idsComorbilidades]
        );

        const paciente = result.rows[0];

        const token = jwt.sign(
            { id: paciente.id_paciente, rol: "paciente" },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.status(201).json({ token, usuario: { nombre: paciente.nombre } });
    } catch (err) {
        if (err.code === "23505") {
            return res.status(409).json({ mensaje: "Ya existe un paciente con ese DNI o mail" });
        }
        // 23503: se mandó un ID de comorbilidad que no existe
        if (err.code === "23503") {
            return res.status(400).json({ mensaje: "Alguna de las comorbilidades no existe" });
        }
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

const registrarseMedico = async (req, res) => {
    const { dni, nombre, apellido, matricula, especialidad, institucion, mail, password } = req.body;

    // institucion no está en la validación: es opcional
    if (!dni || !nombre || !apellido || !matricula || !especialidad || !mail || !password) {
        return res.status(400).json({ mensaje: "Faltan datos obligatorios" });
    }

    // Si no viene, o viene vacía o con solo espacios, se guarda como NULL
    const institucionLimpia = String(institucion ?? "").trim() || "Particular";

    try {
        const hash = await bcrypt.hash(password, 10);

        const result = await query(
            `INSERT INTO medico (dni, nombre, apellido, matricula, especialidad, institucion, mail, password)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id_medico, nombre`,
            [dni, nombre, apellido, matricula, especialidad.trim(), institucionLimpia, mail, hash]
        );

        const medico = result.rows[0];

        const token = jwt.sign(
            { id: medico.id_medico, rol: "medico" },
            process.env.JWT_SECRET,
            { expiresIn: "2h" }
        );

        res.status(201).json({ token, usuario: { nombre: medico.nombre } });
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