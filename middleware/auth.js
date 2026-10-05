import jwt from "jsonwebtoken";

export const verificarToken = (req, res, next) => {
    // 1. Leer el header "Authorization: Bearer <token>"
    const [tipo, token] = (req.headers.authorization ?? "").split(" ");

    if (tipo !== "Bearer" || !token) {
        return res.status(401).json({ mensaje: "Token requerido" });
    }

    try {
        // 2. Verificar la firma y que no haya vencido
        //    Devuelve lo que pusiste en jwt.sign: { id, rol, iat, exp }
        req.usuario = jwt.verify(token, process.env.JWT_SECRET);

        // 3. Dejar pasar al controlador
        next();
    } catch {
        res.status(401).json({ mensaje: "Token inválido o vencido" });
    }
};