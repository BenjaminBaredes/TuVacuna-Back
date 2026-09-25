import express from "express";
const app = express();
const port = 4000;

import pacientes from "./Controllers/paciente.js";

app.use(express.json());

app.get("/", (_, res) => {
  res.send("TuVacuna API working!");
});

app.get("/pacientes", pacientes.getPacientes);
app.get("/pacientes/:id", pacientes.getPaciente);

const server = app.listen(port, () => {
    console.log(`TuVacuna API listening at http://localhost:${port}`);
  });
  
  export { app, server };