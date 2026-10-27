import { db, pool } from "@workspace/db";
import { seedFpaCatalog } from "./lib/seed-fpa";

db.transaction(seedFpaCatalog)
  .then((result) => console.log("Catálogo FPA:", result))
  .catch((error) => { console.error("No se pudo cargar el catálogo FPA:", error); process.exitCode = 1; })
  .finally(() => { void pool.end(); });
