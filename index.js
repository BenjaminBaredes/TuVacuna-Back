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
import perfil from "./Controllers/perfil.js";
import turnos from "./Controllers/turnos.js";
import centros from "./Controllers/centros.js";
import obrasSociales from "./Controllers/obrassociales.js";
import familia from "./Controllers/familia.js";


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
app.get("/api/carnet/:idPaciente", verificarToken, carnet.getCarnetDePaciente);
app.post("/api/carnet/dosis", verificarToken, carnet.postDosis);
app.post("/api/carnet/:idPaciente/dosis", verificarToken, carnet.postDosisFamiliar);

app.get("/api/vacunas", verificarToken, vacunas.getVacunas);

app.get("/api/comorbilidades", comorbilidades.getComorbilidades);

app.get("/api/perfil/comorbilidades", verificarToken, perfil.getMisComorbilidades);
app.put("/api/perfil/comorbilidades", verificarToken, perfil.putMisComorbilidades);
app.get("/api/perfil/comorbilidades/:idPaciente", verificarToken, perfil.getComorbilidadesDePaciente);

app.get("/api/medicos", verificarToken, medicos.buscarMedicos);
app.get("/api/medico/pacientes", verificarToken, medicos.getMisPacientes);
app.get("/api/medico/pacientes/:id", verificarToken, medicos.getPacienteDetalle);

app.get("/api/perfil/medicos", verificarToken, solicitudes.getMisMedicos);
app.delete("/api/perfil/medicos/:id", verificarToken, solicitudes.quitarMedico);
app.post("/api/medicos/:id/solicitud", verificarToken, solicitudes.enviarSolicitud);
app.get("/api/medico/solicitudes", verificarToken, solicitudes.getSolicitudesRecibidas);
app.post("/api/medico/solicitudes/:id/aceptar", verificarToken, solicitudes.aceptarSolicitud);
app.post("/api/medico/solicitudes/:id/rechazar", verificarToken, solicitudes.rechazarSolicitud);

app.get("/api/turnos", verificarToken, turnos.getTurnos);
app.post("/api/turnos", verificarToken, turnos.postTurno);
app.put("/api/turnos/:id", verificarToken, turnos.putTurno);
app.delete("/api/turnos/:id", verificarToken, turnos.deleteTurno);
app.get("/api/calendario/marcados", verificarToken, turnos.getMarcados);

app.get("/api/obras-sociales", obrasSociales.getObrasSociales);

app.get("/api/centros", verificarToken, centros.getCentros);

app.get("/api/familia", verificarToken, familia.getFamilia);
app.post("/api/familia/solicitudes", verificarToken, familia.enviarSolicitud);
app.get("/api/familia/solicitudes/recibidas", verificarToken, familia.getSolicitudesRecibidas);
app.get("/api/familia/solicitudes/enviadas", verificarToken, familia.getSolicitudesEnviadas);
app.post("/api/familia/solicitudes/:id/aceptar", verificarToken, familia.aceptarSolicitud);
app.post("/api/familia/solicitudes/:id/rechazar", verificarToken, familia.rechazarSolicitud);
app.get("/api/familia/acceso", verificarToken, familia.getConAcceso);
app.delete("/api/familia/acceso/:id", verificarToken, familia.quitarAcceso);

if (!process.env.VERCEL) {
  app.listen(port, () => {
      console.log(`TuVacuna API listening at http://localhost:${port}`);
  });
}

export default app;