import { pool } from "@workspace/db";
import { seedNormativaCatalog } from "./lib/seed-normativa";

seedNormativaCatalog()
  .then((result) => console.log("Normativa FP:", result))
  .catch((error) => { console.error("No se pudo cargar el catálogo normativo:", error); process.exitCode = 1; })
  .finally(() => { void pool.end(); });
