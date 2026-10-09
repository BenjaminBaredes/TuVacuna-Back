import express from "express";
const app = express();
const port = 4000;

import pacientes from "./Controllers/paciente.js";
import iniciosesion from "./Controllers/iniciosesion.js";
import usuarios from "./Controllers/usuarios.js";
import { verificarToken } from "./middleware/auth.js";
import carnet from "./Controllers/carnet.js";
import vacunas from "./Controllers/vacunas.js";


app.use(express.json());

app.get("/", (_, res) => {
  res.send("TuVacuna API working!");
});

app.get("/pacientes", pacientes.getPacientes);
app.get("/pacientes/:id", pacientes.getPaciente);

app.post("/api/auth/registro", iniciosesion.registro);
app.post("/api/auth/login", iniciosesion.login);

app.get("/api/usuario/me", verificarToken, usuarios.getMe);

app.get("/api/carnet", verificarToken, carnet.getCarnet);
app.post("/api/carnet/dosis", verificarToken, carnet.postDosis);

app.get("/api/vacunas", verificarToken, vacunas.getVacunas);
  
const server = app.listen(port, () => {
    console.log(`TuVacuna API listening at http://localhost:${port}`);
  });
  
  export { app, server };