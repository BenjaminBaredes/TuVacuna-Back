import { query } from "../db.js";

// ============================================================
// Cálculo de vacunas pendientes, atrasadas y recomendadas.
//
// Estados (definidos por el equipo):
//   pendiente   le corresponde por el Calendario Nacional (por edad o comorbilidad)
//   atrasada    se la debería haber dado y no la tiene cargada
//   recomendada le conviene por edad o comorbilidad, pero está fuera del calendario
//
// Criterio de seguridad: ante la duda, NO se muestra.
//   - Cada dosis tiene una edad máxima: pasada esa edad ya no corresponde y no se marca.
//   - Las dosis que dependen de la zona donde vive la persona, del embarazo, del trabajo
//     o de tratamientos puntuales (fiebre amarilla, FHA, rabia, trasplante, etc.) no se calculan.
//   - Las vacunas anuales (gripe, COVID) nunca se marcan atrasadas: son por campaña.
// Los IDs de vacuna son los de vacunas_calendario_nacional.sql.
// Pendiente de revisión por un profesional de la salud.
// ============================================================

const ZONA = "America/Argentina/Buenos_Aires";
const hoyBA = () => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date());

// Suma meses a una fecha AAAA-MM-DD. Si el día no existe (31 de febrero), usa el último del mes.
const sumarMeses = (fecha, meses) => {
    const [a, m, d] = fecha.split("-").map(Number);
    const ultimoDia = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
    return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
};

// Edad en meses cumplidos
const edadEnMeses = (nacimiento, hoy) => {
    const [a1, m1, d1] = nacimiento.split("-").map(Number);
    const [a2, m2, d2] = hoy.split("-").map(Number);
    return (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
};

// Las pendientes se muestran desde 12 meses antes de que correspondan
const MESES_ANTICIPACION = 12;

// ---------- Reglas por edad (Calendario Nacional) ----------
// desde: edad en meses en la que corresponde (fecha recomendada = nacimiento + desde)
// hasta: desde esa edad, si no se aplicó, queda atrasada
// max:   desde esa edad ya no corresponde: no se muestra (ni pendiente ni atrasada)
// Si hasta === max, la dosis nunca se marca atrasada (la ventana se cierra).
const REGLAS_EDAD = [
    { id: 1, desde: 0, hasta: 1, max: 72 },     // BCG
    { id: 2, desde: 0, hasta: 1, max: 1 },      // Hepatitis B neonatal (después se cubre con la quíntuple)
    { id: 6, desde: 2, hasta: 3, max: 24 },     // Neumococo 1ª
    { id: 7, desde: 4, hasta: 5, max: 24 },     // Neumococo 2ª
    { id: 8, desde: 12, hasta: 15, max: 60 },   // Neumococo refuerzo
    { id: 9, desde: 2, hasta: 3, max: 60 },     // Quíntuple 1ª
    { id: 10, desde: 4, hasta: 5, max: 60 },    // Quíntuple 2ª
    { id: 11, desde: 6, hasta: 7, max: 60 },    // Quíntuple 3ª
    { id: 12, desde: 15, hasta: 19, max: 60 },  // Quíntuple refuerzo (15 a 18 meses)
    // IPV: solo nacidos desde 2020. Los anteriores recibieron la polio oral (Sabin), que no está
    // en la lista de vacunas: si no, les saldría atrasada una vacuna que en realidad tienen.
    { id: 13, desde: 2, hasta: 3, max: 216, nacidosDesde: "2020-01-01" },   // IPV 1ª
    { id: 14, desde: 4, hasta: 5, max: 216, nacidosDesde: "2020-01-01" },   // IPV 2ª
    { id: 15, desde: 6, hasta: 7, max: 216, nacidosDesde: "2020-01-01" },   // IPV 3ª
    { id: 16, desde: 60, hasta: 84, max: 216, nacidosDesde: "2020-01-01" }, // IPV refuerzo (ingreso escolar)
    { id: 17, desde: 2, hasta: 3, max: 3 },     // Rotavirus 1ª (no se recupera: antes de las 14 semanas y 6 días)
    { id: 18, desde: 4, hasta: 5, max: 5 },     // Rotavirus 2ª (no se recupera: antes de las 24 semanas)
    { id: 19, desde: 3, hasta: 4, max: 24 },    // Meningococo ACYW 1ª
    { id: 20, desde: 5, hasta: 6, max: 24 },    // Meningococo ACYW 2ª
    { id: 21, desde: 15, hasta: 16, max: 60 },  // Meningococo ACYW refuerzo
    { id: 22, desde: 132, hasta: 144, max: 156 }, // Meningococo ACYW 11 años
    { id: 23, desde: 12, hasta: 13, max: 60 },  // Hepatitis A
    { id: 24, desde: 12, hasta: 13, max: 216 }, // Triple viral 1ª
    { id: 25, desde: 15, hasta: 19, max: 216, nacidosDesde: "2024-07-01", equivalentes: [26] }, // Triple viral 2ª (15-18 meses)
    { id: 26, desde: 60, hasta: 84, max: 216, nacidosAntes: "2024-07-01", equivalentes: [25] }, // Triple viral 2ª (5 años)
    { id: 29, desde: 15, hasta: 16, max: 84 },  // Varicela 1ª
    { id: 30, desde: 60, hasta: 72, max: 84 },  // Varicela 2ª
    { id: 31, desde: 60, hasta: 72, max: 84 },  // Triple bacteriana celular (5 años)
    { id: 35, desde: 132, hasta: 144, max: 168 }, // dTpa 11 años
    { id: 36, desde: 132, hasta: 144, max: 252, equivalentes: [37, 38, 39, 40, 41] }, // VPH (hasta los 20 años)
];

// ---------- Grupos de comorbilidades ----------
// Se comparan por palabras clave en el nombre (sin tildes ni mayúsculas),
// así sirven aunque cambien los IDs de la tabla comorbilidades.
const INMUNOCOMPROMISO = [
    "vih", "inmunodeficiencia", "inmunosupresion", "corticoides", "quimioterapia", "trasplante",
    "leucemia", "linfoma", "hodgkin", "mieloma", "neoplasica",
];
const RIESGO_GRIPE_COVID = [
    ...INMUNOCOMPROMISO,
    "asma", "epoc", "pulmonar", "fibrosis quistica", "displasia", "bronquiectasias",
    "cardiopatia", "insuficiencia cardiaca", "coronaria", "valvulopatia",
    "diabetes", "obesidad", "renal", "nefrotico", "asplenia", "falciformes",
    "desnutricion", "neuromuscular", "genetico", "malformacion", "retraso madurativo",
    "acido acetilsalicilico",
];
const RIESGO_NEUMOCOCO = [
    ...INMUNOCOMPROMISO,
    "epoc", "pulmonar", "fibrosis quistica", "displasia", "bronquiectasias",
    "cardiopatia", "insuficiencia cardiaca", "coronaria", "valvulopatia",
    "diabetes", "renal", "nefrotico", "hepatica", "cirrosis", "asplenia", "falciformes",
    "implante coclear", "fistula", "alcoholismo", "tabaquismo",
];
const RIESGO_VSR = [
    ...INMUNOCOMPROMISO,
    "asma", "epoc", "pulmonar", "fibrosis quistica", "bronquiectasias",
    "cardiopatia", "insuficiencia cardiaca", "coronaria", "valvulopatia", "diabetes", "renal",
];
const ASPLENIA = ["asplenia", "falciformes"];

const normalizar = (texto) =>
    String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const tieneAlguna = (comorbilidades, grupo) =>
    comorbilidades.some((c) => grupo.some((palabra) => c.includes(palabra)));

// Vacunas que cuentan como "última dosis antitetánica" para el refuerzo de dT cada 10 años
const ANTITETANICAS = [9, 10, 11, 12, 31, 35, 42, 43, 44, 45, 47, 48, 66];
const ANTIGRIPALES = [50, 51, 52];
const COVID = [59, 60, 61];
const VCN20 = [53, 54, 55, 56, 57, 58];

// ---------- Cálculo ----------

// Devuelve las dosis pendientes, atrasadas y recomendadas de un paciente:
// [{ id_vacuna, estado, fecha_recomendada }]
const calcular = (nacimiento, comorbilidadesNombres, aplicadas, hoy) => {
    const resultado = [];
    if (!nacimiento) return resultado; // sin fecha de nacimiento no se puede calcular

    const edad = edadEnMeses(nacimiento, hoy);
    const limiteAnticipacion = sumarMeses(hoy, MESES_ANTICIPACION);
    const comorbilidades = comorbilidadesNombres.map(normalizar);

    // aplicadas: Map id_vacuna -> fecha más reciente (o null si se cargó sin fecha)
    const tiene = (id) => aplicadas.has(id);
    const tieneAlgunaDe = (ids) => ids.some(tiene);
    const ultimaFecha = (ids) => {
        let ultima = null;
        for (const id of ids) {
            const f = aplicadas.get(id);
            if (f && (!ultima || f > ultima)) ultima = f;
        }
        return ultima;
    };

    const agregar = (id_vacuna, estado, fecha_recomendada) =>
        resultado.push({ id_vacuna, estado, fecha_recomendada });

    // 1. Calendario por edad
    for (const r of REGLAS_EDAD) {
        if (r.nacidosDesde && nacimiento < r.nacidosDesde) continue;
        if (r.nacidosAntes && nacimiento >= r.nacidosAntes) continue;
        if (edad >= r.max) continue;
        if (tiene(r.id) || (r.equivalentes && tieneAlgunaDe(r.equivalentes))) continue;

        const fecha = sumarMeses(nacimiento, r.desde);
        if (edad >= r.hasta) {
            agregar(r.id, "atrasada", fecha);
        } else if (fecha <= limiteAnticipacion) {
            agregar(r.id, "pendiente", fecha);
        }
    }

    // 2. Doble bacteriana: refuerzo cada 10 años desde los 18
    if (edad >= 216) {
        const ultima = ultimaFecha(ANTITETANICAS);
        if (!ultima) {
            agregar(45, "pendiente", hoy); // no tiene ninguna antitetánica cargada
        } else {
            const fecha = sumarMeses(ultima, 120);
            if (fecha < hoy) agregar(45, "atrasada", fecha);
            else if (fecha <= limiteAnticipacion) agregar(45, "pendiente", fecha);
        }
    }

    // 3. Antigripal (anual, por campaña: nunca atrasada)
    const riesgoGripe = tieneAlguna(comorbilidades, RIESGO_GRIPE_COVID);
    if (edad >= 6 && edad < 24 && !tieneAlgunaDe(ANTIGRIPALES)) {
        agregar(50, "pendiente", hoy); // primera vez entre 6 y 24 meses: 1ª dosis
    } else if (edad >= 6 && edad < 36 && tiene(50) && !tiene(51)) {
        agregar(51, "pendiente", sumarMeses(aplicadas.get(50) ?? hoy, 1)); // 2ª dosis, 4 semanas después
    } else if ((edad >= 6 && edad < 24) || edad >= 780 || (edad >= 24 && riesgoGripe)) {
        const ultima = ultimaFecha(ANTIGRIPALES);
        const fecha = ultima ? sumarMeses(ultima, 12) : hoy;
        agregar(52, "pendiente", fecha < hoy ? hoy : fecha);
    }

    // 4. COVID-19 (periódica: nunca atrasada)
    const inmuno = tieneAlguna(comorbilidades, INMUNOCOMPROMISO);
    let reglaCovid = null;
    if (edad >= 144 && inmuno) reglaCovid = { id: 61, cada: 6 };
    else if (edad >= 780) reglaCovid = { id: 59, cada: 12 };
    else if (edad >= 144 && riesgoGripe) reglaCovid = { id: 60, cada: 12 };
    if (reglaCovid) {
        const ultima = ultimaFecha(COVID);
        const fecha = ultima ? sumarMeses(ultima, reglaCovid.cada) : hoy;
        if (fecha <= limiteAnticipacion) agregar(reglaCovid.id, "pendiente", fecha < hoy ? hoy : fecha);
    }

    // 5. Neumococo VCN20: una sola vez (65+, o 5 a 64 con factores de riesgo)
    if (!tieneAlgunaDe(VCN20)) {
        const cumple65 = sumarMeses(nacimiento, 780);
        if (edad >= 780) agregar(53, "pendiente", hoy);
        else if (edad >= 60 && tieneAlguna(comorbilidades, RIESGO_NEUMOCOCO)) agregar(54, "pendiente", hoy);
        else if (cumple65 <= limiteAnticipacion) agregar(53, "pendiente", cumple65); // cumple 65 en menos de un año
    }

    // 6. Recomendadas fuera de calendario (nunca atrasadas)
    // VSR adultos: 60+, o adultos con factores de riesgo
    if (!tiene(67) && (edad >= 720 || (edad >= 216 && tieneAlguna(comorbilidades, RIESGO_VSR)))) {
        agregar(67, "recomendada", hoy);
    }
    // Herpes zóster: 50+, o 18+ con inmunocompromiso. 2ª dosis 2 meses después de la 1ª.
    if (edad >= 600 || (edad >= 216 && inmuno)) {
        if (!tiene(68)) agregar(68, "recomendada", hoy);
        else if (!tiene(69)) {
            const fecha = sumarMeses(aplicadas.get(68) ?? hoy, 2);
            agregar(69, "recomendada", fecha < hoy ? hoy : fecha);
        }
    }
    // Meningococo B: personas con asplenia (desde los 2 meses)
    if (edad >= 2 && tieneAlguna(comorbilidades, ASPLENIA)) {
        if (!tiene(62)) agregar(62, "recomendada", hoy);
        else if (!tiene(63)) {
            const fecha = sumarMeses(aplicadas.get(62) ?? hoy, 2);
            agregar(63, "recomendada", fecha < hoy ? hoy : fecha);
        }
    }

    // Atrasadas primero, después por fecha
    const orden = { atrasada: 0, pendiente: 1, recomendada: 2 };
    resultado.sort((a, b) => orden[a.estado] - orden[b.estado] || a.fecha_recomendada.localeCompare(b.fecha_recomendada));
    return resultado;
};

// Busca los datos de un paciente y calcula. Devuelve las dosis con nombre y dosis:
// [{ id_vacuna, nombre, dosis, en_calendario, estado, fecha_recomendada }]
export const calcularPendientes = async (idPaciente) => {
    const [paciente, comorb, dosis] = await Promise.all([
        query(
            "SELECT TO_CHAR(fecha_de_nacimiento, 'YYYY-MM-DD') AS nacimiento FROM paciente WHERE id_paciente = $1",
            [idPaciente]
        ),
        query(
            `SELECT c.nombre FROM tiene_comorbilidad tc
             JOIN comorbilidades c ON c.id_comorbilidad = tc.id_comorbilidad
             WHERE tc.id_paciente = $1`,
            [idPaciente]
        ),
        query(
            `SELECT po.id_vacuna, MAX(TO_CHAR(po.fecha_de_aplicacion, 'YYYY-MM-DD')) AS fecha
             FROM carnet ca JOIN posee po ON po.id_carnet = ca.id_carnet
             WHERE ca.id_paciente = $1
             GROUP BY po.id_vacuna`,
            [idPaciente]
        ),
    ]);

    if (paciente.rows.length === 0) return [];

    const aplicadas = new Map(dosis.rows.map((f) => [f.id_vacuna, f.fecha]));
    const calculadas = calcular(
        paciente.rows[0].nacimiento,
        comorb.rows.map((f) => f.nombre),
        aplicadas,
        hoyBA()
    );
    if (calculadas.length === 0) return [];

    const vacunas = await query(
        "SELECT id_vacuna, nombre, dosis, en_calendario FROM vacunas WHERE id_vacuna = ANY($1::int[])",
        [calculadas.map((c) => c.id_vacuna)]
    );
    const porId = new Map(vacunas.rows.map((v) => [v.id_vacuna, v]));

    return calculadas
        .filter((c) => porId.has(c.id_vacuna))
        .map((c) => ({ ...porId.get(c.id_vacuna), estado: c.estado, fecha_recomendada: c.fecha_recomendada }));
};

// Estado general de un paciente para la lista del médico:
//   "atrasada" si tiene alguna dosis del calendario atrasada,
//   "proxima"  si le toca una dosis del calendario en los próximos 30 días (o ya le toca),
//   "al-dia"   si no tiene nada de lo anterior.
export const estadoGeneral = (pendientes) => {
    const enCalendario = pendientes.filter((p) => p.en_calendario);
    if (enCalendario.some((p) => p.estado === "atrasada")) return "atrasada";
    const limite = sumarMeses(hoyBA(), 1);
    if (enCalendario.some((p) => p.estado === "pendiente" && p.fecha_recomendada <= limite)) return "proxima";
    return "al-dia";
};

// Solo para las pruebas
export const _calcular = calcular;