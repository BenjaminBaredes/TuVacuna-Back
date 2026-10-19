import express from "express";
import cors from "cors";
const app = express();
const port = 4000;

//import pacientes from "./Controllers/paciente.js";
import iniciosesion from "./Controllers/iniciosesion.js";
import usuarios from "./Controllers/usuarios.js";
import { verificarToken } from "./middleware/auth.js";
import carnet from "./Controllers/carnet.js";
import vacunas from "./Controllers/vacunas.js";
import comorbilidades from "./Controllers/comorbilidades.js";
import medicos from "./Controllers/medicos.js";
import solicitudes from "./Controllers/solicitudes.js";

app.use(cors());
app.use(express.json());

app.get("/", (_, res) => {
  res.send("TuVacuna API working!");
});

//app.get("/pacientes", pacientes.getPacientes);
//app.get("/pacientes/:id", pacientes.getPaciente);

app.post("/api/auth/registro", iniciosesion.registro);
app.post("/api/auth/login", iniciosesion.login);

app.get("/api/usuario/me", verificarToken, usuarios.getMe);

app.get("/api/carnet", verificarToken, carnet.getCarnet);
app.post("/api/carnet/dosis", verificarToken, carnet.postDosis);

app.get("/api/vacunas", verificarToken, vacunas.getVacunas);

app.get("/api/comorbilidades", comorbilidades.getComorbilidades);

app.get("/api/medicos", verificarToken, medicos.buscarMedicos);
 
app.post("/api/medicos/:id/solicitud", verificarToken, solicitudes.enviarSolicitud);
app.get("/api/medico/solicitudes", verificarToken, solicitudes.getSolicitudesRecibidas);

if (!process.env.VERCEL) {
  app.listen(port, () => {
      console.log(`TuVacuna API listening at http://localhost:${port}`);
  });
}

export default app;