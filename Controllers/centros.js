import { query } from "../db.js";

// Saca tildes y pasa a minúsculas, para que "San Cristóbal" encuentre "San Cristobal"
const SIN_TILDES = (expr) => `translate(lower(${expr}), 'áéíóúüñ', 'aeiouun')`;

// GET /api/centros?busqueda=&tipo=
// Todos ven los centros públicos. Un paciente con obra social ve además
// los centros privados que atienden su obra social.
const getCentros = async (req, res) => {
    const { id, rol } = req.usuario;
    const { busqueda, tipo } = req.query;

    if (tipo !== undefined && tipo !== "" && tipo !== "publico" && tipo !== "privado") {
        return res.status(400).json({ mensaje: "tipo debe ser 'publico' o 'privado'" });
    }

    // El texto de búsqueda se usa dentro de un LIKE: se escapan % y _ para que se busquen tal cual
    const texto = busqueda ? String(busqueda).trim().replace(/[\\%_]/g, "\\$&") : "";

    try {
        // La obra social sale del perfil del paciente, no de la URL
        let idObraSocial = null;
        if (rol === "paciente") {
            const paciente = await query("SELECT id_obra_social FROM paciente WHERE id_paciente = $1", [id]);
            idObraSocial = paciente.rows[0]?.id_obra_social ?? null;
        }

        const result = await query(
            `SELECT c.id_centro AS id, c.nombre, c.direccion, c.tipo,
                    c.lat::float8 AS lat, c.lng::float8 AS lng
             FROM centro c
             WHERE (
                     c.tipo = 'publico'
                     OR EXISTS (SELECT 1 FROM centro_obra_social co
                                WHERE co.id_centro = c.id_centro AND co.id_obra_social = $1)
                   )
               AND ($2::text IS NULL OR c.tipo = $2)
               AND ($3::text = '' OR ${SIN_TILDES("coalesce(c.barrio, '') || ' ' || c.direccion")}
                                     LIKE '%' || ${SIN_TILDES("$3")} || '%')
             ORDER BY c.nombre`,
            [idObraSocial, tipo || null, texto]
        );

        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ mensaje: "Error interno" });
    }
};

export default { getCentros };