import { query } from "../db.js";
import { INSTRUCCIONES, CONOCIMIENTO } from "./asistenteConocimiento.js";

// Asistente de TuVacuna: el mismo chatbot del repositorio CHATBOT, pasado a Node.
// Usa la IA de ORT (compatible con OpenAI). La clave va en la variable de entorno TIC_API_KEY
// (en Vercel: Settings > Environment Variables), nunca en el código.
const URL_API = "https://ia-tic.ort.edu.ar/api/v1/chat/completions";
const MODELO = "tic-chat";
const MAX_MENSAJES_HISTORIAL = 20; // para no mandar conversaciones infinitas (igual que el original)
const MAX_LARGO_MENSAJE = 2000;
const TIEMPO_MAXIMO_MS = 25000;

const hoyBA = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());

const edadEnAnios = (nacimiento) => {
    const [a1, m1, d1] = nacimiento.split("-").map(Number);
    const [a2, m2, d2] = hoyBA().split("-").map(Number);
    return a2 - a1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
};

// "DATOS DEL USUARIO" del prompt original: edad, sexo y comorbilidades del paciente
const datosDelPaciente = async (idPaciente) => {
    const [paciente, comorb] = await Promise.all([
        query(
            "SELECT TO_CHAR(fecha_de_nacimiento, 'YYYY-MM-DD') AS nacimiento, sexo FROM paciente WHERE id_paciente = $1",
            [idPaciente]
        ),
        query(
            `SELECT c.nombre FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = $1 ORDER BY c.nombre`,
            [idPaciente]
        ),
    ]);
    const p = paciente.rows[0];
    if (!p) return null;

    const lineas = [];
    if (p.nacimiento) lineas.push(`- Edad: ${edadEnAnios(p.nacimiento)} años`);
    if (p.sexo) lineas.push(`- Sexo: ${p.sexo}`);
    if (comorb.rows.length > 0) lineas.push(`- Comorbilidades: ${comorb.rows.map((c) => c.nombre).join(", ")}`);
    return lineas.length > 0 ? lineas.join("\n") : null;
};

// "VACUNAS CARGADAS EN EL CARNET DEL USUARIO", con el mismo formato que formatear_carnet() del original
const carnetDelPaciente = async (idPaciente) => {
    const result = await query(
        `SELECT v.nombre, v.dosis, TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD') AS fecha
         FROM carnet ca
         JOIN posee po ON po.id_carnet = ca.id_carnet
         JOIN vacunas v ON v.id_vacuna = po.id_vacuna
         WHERE ca.id_paciente = $1
         ORDER BY po.fecha_de_aplicacion NULLS LAST`,
        [idPaciente]
    );
    if (result.rows.length === 0) return null;
    return result.rows
        .map((f) => `- ${f.nombre} – ${f.dosis} – aplicada el ${f.fecha ?? "fecha sin cargar"}`)
        .join("\n");
};

// Igual que armar_system_prompt() del original
const armarSystemPrompt = (carnet, datos) => {
    let prompt = `${INSTRUCCIONES}\n\n=== BASE DE CONOCIMIENTO ===\n${CONOCIMIENTO}`;
    if (datos) prompt += `\n\n=== DATOS DEL USUARIO ===\n${datos}`;
    if (carnet) prompt += `\n\n=== VACUNAS CARGADAS EN EL CARNET DEL USUARIO ===\n${carnet}`;
    return prompt;
};

// POST /api/asistente
// body: { mensajes: [{ role: "user" | "assistant", content: "..." }, ...] }
// La conversación entera (el servidor no la guarda): el último mensaje es la pregunta nueva.
const preguntar = async (req, res) => {
    const { id, rol } = req.usuario;
    const { mensajes } = req.body ?? {};

    if (!Array.isArray(mensajes) || mensajes.length === 0) {
        return res.status(400).json({ mensaje: "mensajes debe ser una lista con al menos la pregunta" });
    }
    for (const m of mensajes) {
        if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) {
            return res.status(400).json({ mensaje: "Cada mensaje necesita role ('user' o 'assistant') y content (texto)" });
        }
        if (m.content.length > MAX_LARGO_MENSAJE) {
            return res.status(400).json({ mensaje: `Cada mensaje puede tener hasta ${MAX_LARGO_MENSAJE} caracteres` });
        }
    }
    if (mensajes[mensajes.length - 1].role !== "user") {
        return res.status(400).json({ mensaje: "El último mensaje tiene que ser la pregunta del usuario" });
    }

    if (!process.env.TIC_API_KEY) {
        console.error("Falta la variable de entorno TIC_API_KEY");
        return res.status(500).json({ mensaje: "El asistente no está configurado" });
    }

    // 1. Datos del paciente para el contexto. Si fallan, el bot responde igual, sin personalizar.
    let carnet = null;
    let datos = null;
    if (rol === "paciente") {
        try {
            [carnet, datos] = await Promise.all([carnetDelPaciente(id), datosDelPaciente(id)]);
        } catch (err) {
            console.error("Asistente: no se pudieron leer los datos del paciente:", err);
        }
    }

    const historial = mensajes
        .slice(-MAX_MENSAJES_HISTORIAL)
        .map((m) => ({ role: m.role, content: m.content.trim() }));

    // 2. Pedido a la IA de ORT
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);

    let respuestaApi;
    try {
        respuestaApi = await fetch(URL_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.TIC_API_KEY.trim()}`,
            },
            body: JSON.stringify({
                model: MODELO,
                messages: [{ role: "system", content: armarSystemPrompt(carnet, datos) }, ...historial],
                temperature: 0.2, // igual que el original: respuestas precisas, poco "creativas"
            }),
            signal: control.signal,
        });
    } catch (err) {
        if (err.name === "AbortError") {
            return res.status(504).json({ mensaje: "El asistente tardó demasiado. Probá de nuevo." });
        }
        // No se pudo ni conectar: servidor caído, bloqueado fuera de la red de ORT, certificado, etc.
        console.error("Asistente: no se pudo conectar con la IA de ORT:", err.message, err.cause ?? "");
        return res.status(502).json({ mensaje: "No se pudo conectar con la IA de ORT" });
    } finally {
        clearTimeout(temporizador);
    }

    // 3. Leer la respuesta
    const texto = await respuestaApi.text().catch(() => "");

    if (!respuestaApi.ok) {
        console.error("Error de la IA de ORT:", respuestaApi.status, texto.slice(0, 500));
        return res.status(502).json({ mensaje: `El asistente no está disponible en este momento (ORT respondió ${respuestaApi.status})` });
    }

    let datosApi;
    try {
        datosApi = JSON.parse(texto);
    } catch {
        // Por ejemplo, una página de inicio de sesión en lugar de JSON
        console.error("Asistente: la IA de ORT no devolvió JSON:", texto.slice(0, 500));
        return res.status(502).json({ mensaje: "La IA de ORT devolvió una respuesta inesperada" });
    }

    const respuesta = datosApi?.choices?.[0]?.message?.content;
    if (!respuesta) {
        console.error("Asistente: respuesta sin texto:", texto.slice(0, 500));
        return res.status(502).json({ mensaje: "El asistente no devolvió una respuesta" });
    }

    res.json({ respuesta });
};

export default { preguntar };