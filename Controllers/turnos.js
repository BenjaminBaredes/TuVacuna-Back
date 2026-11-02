import { query } from "../db.js";
import { tieneAcceso, idsVisibles } from "./familia.js";
import { calcularPendientes } from "./calculoVacunas.js";

// Las fechas se calculan con la hora de Buenos Aires: Vercel corre en UTC,
// y sin esto, a la noche "hoy" ya sería mañana.
const ZONA = "America/Argentina/Buenos_Aires";

// Fecha de hoy en Buenos Aires, como texto AAAA-MM-DD
const hoyBA = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());

// Primer día de un mes, como texto AAAA-MM-DD. El mes va de 0 a 11 (como en JS),
// y admite -1 o 12: Date.UTC lo pasa solo al año anterior o al siguiente.
const primerDia = (anio, mes) => new Date(Date.UTC(anio, mes, 1)).toISOString().slice(0, 10);

// true si el texto es una fecha AAAA-MM-DD que existe (descarta 2026-02-30)
const esFechaValida = (texto) => {
    if (typeof texto !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
    const [a, m, d] = texto.split("-").map(Number);
    const fecha = new Date(Date.UTC(a, m - 1, d));
    return fecha.getUTCFullYear() === a && fecha.getUTCMonth() === m - 1 && fecha.getUTCDate() === d;
};

// Hora HH:MM de 00:00 a 23:59
const esHoraValida = (texto) => typeof texto === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(texto);

// Lee un número entero opcional de la URL. Sin valor devuelve null.
const leerEntero = (valor, min, max) => {
    if (valor === undefined || valor === "") return { valor: null };
    const n = Number(valor);
    if (!Number.isInteger(n) || n < min || n > max) return { error: true };
    return { valor: n };
};

// Lee ?mes=&anio= (mes de 0 a 11). Si falta el año, usa el actual.
const leerMesAnio = (consulta) => {
    const mes = leerEntero(consulta.mes, 0, 11);
    const anio = leerEntero(consulta.anio, 1900, 2200);
    if (mes.error || anio.error) return { error: true };
    return { mes: mes.valor, anio: anio.valor ?? Number(hoyBA().slice(0, 4)) };
};

// Lo que devuelve cada turno. mes va de 0 a 11, como pidió el front.
// estado: un turno agendado es una dosis "pendiente". Cuando hagamos el cálculo
// de vacunas, acá se va a distinguir si ya se aplicó o si quedó atrasada.
const SELECT_TURNO = `
    SELECT ca.id_calendario AS id,
           TO_CHAR(ca.fecha, 'YYYY-MM-DD') AS fecha,
           EXTRACT(DAY FROM ca.fecha)::int AS dia,
           EXTRACT(MONTH FROM ca.fecha)::int - 1 AS mes,
           EXTRACT(YEAR FROM ca.fecha)::int AS anio,
           TO_CHAR(ca.hora, 'HH24:MI') AS hora,
           ca.lugar, 'pendiente' AS estado,
           v.id_vacuna, v.nombre, v.dosis, v.en_calendario,
           p.id_paciente, p.nombre AS paciente_nombre, p.apellido AS paciente_apellido
    FROM calendario ca
    JOIN vacunas v ON v.id_vacuna = ca.id_vacuna
    JOIN paciente p ON p.id_paciente = ca.id_paciente`;

// Arma la respuesta de un turno. "paciente" dice de quién es: el calendario
// junta los turnos propios con los de los familiares, y esVos marca los propios.
const formatear = (fila, idUsuario) => {
    const { id_paciente, paciente_nombre, paciente_apellido, ...turno } = fila;
    return {
        ...turno,
        paciente: {
            id_paciente,
            nombre: paciente_nombre,
            apellido: paciente_apellido,
            esVos: id_paciente === idUsuario,
        },
    };
};

const buscarTurno = async (idTurno, idUsuario) => {
    const result = await query(`${SELECT_TURNO} WHERE ca.id_calendario = $1`, [idTurno]);
    return formatear(result.rows[0], idUsuario);
};

// Valida hora y lugar, que son opcionales. Devuelve el valor a guardar o un error.
const leerHora = (hora) => {
    if (hora === undefined || hora === null || hora === "") return { valor: null };
    if (!esHoraValida(hora)) return { error: "La hora debe tener formato HH:MM" };
    return { valor: hora };
};

// Lugar en texto libre: es provisorio, cuando existan los centros se reemplaza por id_centro
const leerLugar = (lugar) => {
    if (lugar === undefined || lugar === null) return { valor: null };
    const limpio = String(lugar).trim();
    if (limpio.length > 200) return { error: "El lugar no puede superar los 200 caracteres" };
    return { valor: limpio || null };
};

// Valida el cuerpo de un turno (lo usan el POST y el PUT).
// Devuelve { error } o los datos listos para guardar.
const validarTurno = (cuerpo) => {
    const { id_vacuna, fecha } = cuerpo ?? {};

    if (!id_vacuna || !fecha) return { error: "Faltan datos obligatorios (id_vacuna, fecha)" };
    if (!Number.isInteger(Number(id_vacuna))) return { error: "id_vacuna inválido" };
    if (!esFechaValida(fecha)) return { error: "La fecha debe ser válida y tener formato AAAA-MM-DD" };
    if (fecha < hoyBA()) return { error: "La fecha del turno no puede ser anterior a hoy" };

    const hora = leerHora(cuerpo.hora);
    if (hora.error) return { error: hora.error };
    const lugar = leerLugar(cuerpo.lugar);
    if (lugar.error) return { error: lugar.error };

    return { id_vacuna: Number(id_vacuna), fecha, hora: hora.valor, lugar: lugar.valor };
};

const existeVacuna = async (idVacuna) => {
    const result = await query("SELECT 1 FROM vacunas WHERE id_vacuna = $1", [idVacuna]);
    return result.rows.length > 0;
};

// GET /api/turnos?mes=&anio=
// Los turnos del mes pedido, o de todo el año si no viene mes.
// Trae los propios y los de los familiares a los que el paciente tiene acceso.
const getTurnos = async (req, res) => {
    const { id, rol } = req.usuario;
    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen turnos" });
    }

    const { mes, anio, error } = leerMesAnio(req.query);
    if (error) {
        return res.status(400).json({ mensaje: "mes debe ir de 0 a 11 y anio debe ser un año válido" });
    }

    const desde = mes === null ? primerDia(anio, 0) : primerDia(anio, mes);
    const hasta = mes === null ? primerDia(anio + 1, 0) : primerDia(anio, mes + 1);

    try {
        const ids = await idsVisibles(id);
        const result = await query(
            `${SELECT_TURNO}
             WHERE ca.id_paciente = ANY($1::int[]) AND ca.fecha >= $2 AND ca.fecha < $3
             ORDER BY ca.fecha, ca.hora NULLS LAST, ca.id_calendario`,
            [ids, desde, hasta]
        );
        res.json(result.rows.map((fila) => formatear(fila, id)));
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// GET /api/calendario/marcados?mes=&anio=
// Los días con algo para pintar en la grilla: el mes pedido, el anterior y el siguiente.
const getMarcados = async (req, res) => {
    const { id, rol } = req.usuario;
    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen calendario" });
    }

    const leido = leerMesAnio(req.query);
    if (leido.error) {
        return res.status(400).json({ mensaje: "mes debe ir de 0 a 11 y anio debe ser un año válido" });
    }
    const hoy = hoyBA();
    const anio = leido.anio;
    const mes = leido.mes ?? Number(hoy.slice(5, 7)) - 1;

    const desde = primerDia(anio, mes - 1);
    const hasta = primerDia(anio, mes + 2);

    try {
        // Incluye los turnos y las vacunas calculadas de los familiares a los que el paciente tiene acceso.
        const ids = await idsVisibles(id);
        const result = await query(
            `SELECT DISTINCT TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, 'turno' AS tipo
             FROM calendario
             WHERE id_paciente = ANY($1::int[]) AND fecha >= $2 AND fecha < $3`,
            [ids, desde, hasta]
        );

        const marcas = result.rows;
        if (hoy >= desde && hoy < hasta) {
            marcas.push({ fecha: hoy, tipo: "hoy" });
        }

        // Vacunas calculadas, en su fecha recomendada:
        // atrasada -> "atrasado"; pendiente o recomendada -> "recomendado"
        const yaMarcado = new Set(marcas.map((m) => `${m.fecha}|${m.tipo}`));
        const calculadas = await Promise.all(ids.map((idPaciente) => calcularPendientes(idPaciente)));
        for (const p of calculadas.flat()) {
            if (p.fecha_recomendada < desde || p.fecha_recomendada >= hasta) continue;
            const tipo = p.estado === "atrasada" ? "atrasado" : "recomendado";
            const clave = `${p.fecha_recomendada}|${tipo}`;
            if (!yaMarcado.has(clave)) {
                yaMarcado.add(clave);
                marcas.push({ fecha: p.fecha_recomendada, tipo });
            }
        }

        marcas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.tipo.localeCompare(b.tipo));

        res.json(
            marcas.map((m) => ({
                dia: Number(m.fecha.slice(8, 10)),
                mes: Number(m.fecha.slice(5, 7)) - 1,
                anio: Number(m.fecha.slice(0, 4)),
                tipo: m.tipo,
            }))
        );
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// POST /api/turnos
// body: { id_vacuna, fecha, hora?, lugar?, id_familiar? }
// Sin id_familiar, el turno es propio. Con id_familiar, es para ese familiar
// (tiene que haber aceptado la solicitud).
const postTurno = async (req, res) => {
    const { id, rol } = req.usuario;
    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen turnos" });
    }

    const turno = validarTurno(req.body);
    if (turno.error) return res.status(400).json({ mensaje: turno.error });

    const { id_familiar } = req.body ?? {};
    let idPaciente = id;
    if (id_familiar !== undefined && id_familiar !== null && id_familiar !== id) {
        if (!Number.isInteger(id_familiar)) {
            return res.status(400).json({ mensaje: "id_familiar debe ser un ID numérico" });
        }
        idPaciente = id_familiar;
    }

    try {
        if (idPaciente !== id && !(await tieneAcceso(id, idPaciente))) {
            return res.status(404).json({ mensaje: "Familiar no encontrado" });
        }

        if (!(await existeVacuna(turno.id_vacuna))) {
            return res.status(404).json({ mensaje: "Vacuna no encontrada" });
        }

        const result = await query(
            `INSERT INTO calendario (id_paciente, id_vacuna, fecha, hora, lugar)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id_calendario`,
            [idPaciente, turno.id_vacuna, turno.fecha, turno.hora, turno.lugar]
        );

        res.status(201).json(await buscarTurno(result.rows[0].id_calendario, id));
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// PUT /api/turnos/:id
// body: el turno completo, igual que en el POST: { id_vacuna, fecha, hora?, lugar? }
// Reemplaza todo: si no viene hora o lugar, quedan vacíos.
// Sirve para turnos propios y de familiares con acceso. No cambia de quién es el turno.
const putTurno = async (req, res) => {
    const { id, rol } = req.usuario;
    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen turnos" });
    }

    const idTurno = Number(req.params.id);
    if (!Number.isInteger(idTurno)) {
        return res.status(400).json({ mensaje: "ID de turno inválido" });
    }

    const turno = validarTurno(req.body);
    if (turno.error) return res.status(400).json({ mensaje: turno.error });

    try {
        if (!(await existeVacuna(turno.id_vacuna))) {
            return res.status(404).json({ mensaje: "Vacuna no encontrada" });
        }

        const ids = await idsVisibles(id);
        const result = await query(
            `UPDATE calendario
             SET id_vacuna = $1, fecha = $2, hora = $3, lugar = $4
             WHERE id_calendario = $5 AND id_paciente = ANY($6::int[])
             RETURNING id_calendario`,
            [turno.id_vacuna, turno.fecha, turno.hora, turno.lugar, idTurno, ids]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Turno no encontrado" });
        }

        res.json(await buscarTurno(idTurno, id));
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

// DELETE /api/turnos/:id — cancelar un turno lo borra (propio o de un familiar con acceso)
const deleteTurno = async (req, res) => {
    const { id, rol } = req.usuario;
    if (rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes tienen turnos" });
    }

    const idTurno = Number(req.params.id);
    if (!Number.isInteger(idTurno)) {
        return res.status(400).json({ mensaje: "ID de turno inválido" });
    }

    try {
        const ids = await idsVisibles(id);
        const result = await query(
            "DELETE FROM calendario WHERE id_calendario = $1 AND id_paciente = ANY($2::int[]) RETURNING id_calendario",
            [idTurno, ids]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ mensaje: "Turno no encontrado" });
        }

        res.json({ id: idTurno, estado: "eliminado" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getTurnos, getMarcados, postTurno, putTurno, deleteTurno };