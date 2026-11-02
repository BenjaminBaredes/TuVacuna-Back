import { query } from "../db.js";

// Conexión con el lector de carnets (repositorio Pruebas-OCR).
// El OCR corre en una compu aparte con: python ocr_carnet_multiformato.py --servir
// y se expone con un túnel. Su dirección pública va en la variable de entorno OCR_URL
// (en Vercel: Settings > Environment Variables), por ejemplo https://algo.trycloudflare.com
//
// Flujo (sin mantener la conexión abierta, porque leer una foto puede tardar):
//   1. POST /api/ocr/lecturas con la foto  -> { lectura_id }
//   2. GET  /api/ocr/lecturas/:id cada 2-3 segundos hasta que estado sea "listo"
//   3. La persona revisa lo leído y guarda cada dosis con POST /api/carnet/dosis
// Nada se guarda solo: el OCR se equivoca y todo requiere revisión.

const TIEMPO_MAXIMO_MS = 20000;

const urlOcr = () => (process.env.OCR_URL ?? "").replace(/\/+$/, "");

const llamarOcr = async (ruta, opciones = {}) => {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
    try {
        return await fetch(`${urlOcr()}${ruta}`, { ...opciones, signal: control.signal });
    } finally {
        clearTimeout(temporizador);
    }
};

// ---------- Traducir lo leído a nuestra lista de vacunas ----------

const normalizar = (texto) =>
    String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Palabras clave del nombre leído -> IDs de nuestras vacunas (vacunas_calendario_nacional.sql).
// El orden importa: se usa la primera regla que coincide (por eso pentavalente va antes que polio).
const FAMILIAS = [
    { claves: ["meningococo b", "meningococica b", "bexsero"], ids: [62, 63, 64, 65] },
    { claves: ["pentavalente", "quintuple", "quintupla"], ids: [9, 10, 11, 12] },
    { claves: ["hepatitis b", "hep b", "hbv"], ids: [2, 3, 4, 5] },
    { claves: ["hepatitis a", "hep a"], ids: [23] },
    { claves: ["bcg"], ids: [1] },
    { claves: ["vcn20", "vcn 20", "prevenar 20"], ids: [53, 54, 55, 56, 57, 58] },
    { claves: ["neumoc", "neumoco"], ids: [6, 7, 8, 53, 54] },
    { claves: ["rotavirus"], ids: [17, 18] },
    { claves: ["polio", "ipv", "salk", "sabin", "vpi", "opv"], ids: [13, 14, 15, 16] },
    { claves: ["meningoc", "acyw", "acwy"], ids: [19, 20, 21, 22] },
    { claves: ["doble viral"], ids: [28] },
    { claves: ["triple viral", "srp", "sarampion", "mmr"], ids: [24, 25, 26, 27] },
    { claves: ["varicela"], ids: [29, 30] },
    { claves: ["acelular", "dtpa", "tdap"], ids: [35, 47, 48, 66] },
    { claves: ["triple bacteriana", "dtp", "cuadruple"], ids: [31] },
    { claves: ["doble bacteriana", "doble adultos", "antitetanica", "dt "], ids: [45, 42, 43, 44] },
    { claves: ["vph", "hpv", "papiloma"], ids: [36, 37, 38, 39, 40, 41] },
    { claves: ["fiebre amarilla", "amarilica"], ids: [32, 33, 34] },
    { claves: ["hemorragica", "candid", "fha"], ids: [46] },
    { claves: ["gripe", "influenza", "antigripal"], ids: [52, 50, 51] },
    { claves: ["covid", "sars"], ids: [59, 60, 61] },
    { claves: ["sincicial", "sincitial", "vsr", "vrs"], ids: [49, 67] },
    { claves: ["zoster", "shingrix"], ids: [68, 69] },
    { claves: ["dengue", "qdenga"], ids: [70, 71] },
    { claves: ["rabia", "antirrabica"], ids: [72, 73, 74, 75, 76, 77, 78, 79, 80] },
];

// "1ª dosis", "Única", "Refuerzo"... -> con qué empieza (o qué contiene) el texto de nuestra dosis
const claveDosis = (dosisOcr) => {
    const d = normalizar(dosisOcr);
    if (!d) return null;
    if (/\b1|primera/.test(d)) return "1ª";
    if (/\b2|segunda/.test(d)) return "2ª";
    if (/\b3|tercera/.test(d)) return "3ª";
    if (/\b4|cuarta/.test(d)) return "4ª";
    if (/refuerzo|revacun/.test(d)) return "refuerzo";
    if (/unica/.test(d)) return "única";
    if (/anual/.test(d)) return "anual";
    return null;
};

const MESES = {
    ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

// Convierte la fecha leída ("291210", "28-02-11", "11-Mayo-11", "19/01/2012") a AAAA-MM-DD.
// Si no se puede interpretar con seguridad, devuelve null y la persona la completa.
const interpretarFecha = (fechaOcr) => {
    const t = normalizar(fechaOcr);
    if (!t) return null;
    let d, m, a;
    let partes = t.match(/^(\d{1,2})[\s./-]+([a-z]+|\d{1,2})[\s./-]+(\d{2}|\d{4})$/);
    if (partes) {
        d = Number(partes[1]);
        m = /^\d+$/.test(partes[2]) ? Number(partes[2]) : MESES[partes[2].slice(0, 3)];
        a = Number(partes[3]);
    } else if ((partes = t.match(/^(\d{2})(\d{2})(\d{2}|\d{4})$/))) {
        d = Number(partes[1]);
        m = Number(partes[2]);
        a = Number(partes[3]);
    } else {
        return null;
    }
    if (!m) return null;
    if (a < 100) {
        const anioActual = new Date().getFullYear() % 100;
        a += a <= anioActual ? 2000 : 1900;
    }
    const fecha = new Date(Date.UTC(a, m - 1, d));
    if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
    const texto = fecha.toISOString().slice(0, 10);
    return texto <= new Date().toISOString().slice(0, 10) ? texto : null; // una dosis aplicada no puede ser futura
};

// Para cada registro leído: las vacunas candidatas de nuestra lista y la más probable
const traducirRegistros = async (registros) => {
    const vacunas = await query("SELECT id_vacuna, nombre, dosis FROM vacunas");
    const porId = new Map(vacunas.rows.map((v) => [v.id_vacuna, v]));

    return registros.map((r) => {
        const nombre = ` ${normalizar(r.vacuna)} `;
        const familia = FAMILIAS.find((f) => f.claves.some((c) => nombre.includes(c)));
        const candidatas = familia ? familia.ids.filter((id) => porId.has(id)).map((id) => porId.get(id)) : [];

        let sugerida = null;
        const clave = claveDosis(r.dosis);
        if (candidatas.length === 1) {
            sugerida = candidatas[0];
        } else if (clave) {
            sugerida =
                candidatas.find((v) => normalizar(v.dosis).startsWith(normalizar(clave))) ??
                candidatas.find((v) => normalizar(v.dosis).includes(normalizar(clave))) ??
                null;
        }

        return {
            vacuna_ocr: r.vacuna ?? null,
            dosis_ocr: r.dosis ?? null,
            fecha_ocr: r.fecha ?? null,
            id_vacuna_sugerida: sugerida ? sugerida.id_vacuna : null,
            candidatas,
            fecha_sugerida: interpretarFecha(r.fecha),
            lote: r.lote ?? null,
            marca: r.marca ?? null,
        };
    });
};

// ---------- Endpoints ----------

const verificarConfiguracion = (res) => {
    if (!urlOcr()) {
        console.error("Falta la variable de entorno OCR_URL");
        res.status(500).json({ mensaje: "El lector de carnets no está configurado" });
        return false;
    }
    return true;
};

// POST /api/ocr/lecturas — el cuerpo es la foto tal cual (Content-Type image/jpeg, image/png o image/webp)
const iniciarLectura = async (req, res) => {
    if (req.usuario.rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes cargan su carnet" });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.status(400).json({ mensaje: "Mandá la foto como cuerpo del pedido (image/jpeg, image/png o image/webp)" });
    }
    if (!verificarConfiguracion(res)) return;

    try {
        const tipo = req.headers["content-type"];
        const extension = tipo === "image/png" ? "png" : tipo === "image/webp" ? "webp" : "jpg";
        const formulario = new FormData();
        formulario.append("imagen", new Blob([req.body], { type: tipo }), `carnet.${extension}`);

        const respuesta = await llamarOcr("/lecturas", { method: "POST", body: formulario });
        const datos = await respuesta.json().catch(() => ({}));

        if (respuesta.status === 429) {
            return res.status(429).json({ mensaje: "El lector está ocupado. Probá de nuevo en un momento." });
        }
        if (!respuesta.ok) {
            console.error("Error del OCR:", respuesta.status, datos);
            return res.status(502).json({ mensaje: datos.detail ?? "El lector de carnets no pudo recibir la foto" });
        }

        res.status(202).json({ lectura_id: datos.lectura_id, estado: datos.estado });
    } catch (err) {
        console.error(err);
        res.status(502).json({ mensaje: "No se pudo conectar con el lector de carnets. ¿Está encendido?" });
    }
};

// GET /api/ocr/lecturas/:id — estado de la lectura; cuando está lista, devuelve lo leído
const estadoLectura = async (req, res) => {
    if (req.usuario.rol !== "paciente") {
        return res.status(403).json({ mensaje: "Solo los pacientes cargan su carnet" });
    }
    const id = String(req.params.id);
    if (!/^[a-f0-9]{32}$/.test(id)) {
        return res.status(400).json({ mensaje: "ID de lectura inválido" });
    }
    if (!verificarConfiguracion(res)) return;

    try {
        const respuesta = await llamarOcr(`/lecturas/${id}`);
        const datos = await respuesta.json().catch(() => ({}));

        if (respuesta.status === 404) {
            return res.status(404).json({ mensaje: "La lectura no existe o expiró. Volvé a subir la foto." });
        }
        if (!respuesta.ok) {
            console.error("Error del OCR:", respuesta.status, datos);
            return res.status(502).json({ mensaje: "El lector de carnets no respondió bien" });
        }

        if (datos.estado === "en_cola" || datos.estado === "procesando") {
            return res.json({ estado: datos.estado, etapa: datos.progreso?.etapa ?? null });
        }

        // Terminó (bien o mal): se cierra la lectura en el OCR, que admite solo 3 abiertas a la vez
        llamarOcr(`/lecturas/${id}`, { method: "DELETE" }).catch(() => {});

        if (datos.estado === "error") {
            return res.status(422).json({ mensaje: datos.detalle ?? "No se pudo leer la foto" });
        }

        res.json({
            estado: "listo",
            registros: await traducirRegistros(datos.registros ?? []),
            avisos: datos.avisos ?? [],
        });
    } catch (err) {
        console.error(err);
        res.status(502).json({ mensaje: "No se pudo conectar con el lector de carnets. ¿Está encendido?" });
    }
};

export default { iniciarLectura, estadoLectura };

// Solo para las pruebas
export const _interpretarFecha = interpretarFecha;