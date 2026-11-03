import { db, pool } from "@workspace/db";
import { seedForumThreads } from "./lib/seed-forum-threads";

db.transaction(tx => seedForumThreads(tx))
  .then(stats => {
    console.log(`Subforos ADG: ${stats.activated} módulos activados; ${stats.threads} temas creados.`);
    for (const reason of stats.skipped) console.warn(`Subforo omitido — ${reason}`);
    console.log("Se conservan las ediciones, los temas archivados y las incidencias pendientes. No se envían avisos masivos por esta carga.");
  })
  .catch(error => {
    console.error("No se pudieron preparar los subforos; se ha revertido esta carga:", error);
    process.exitCode = 1;
  })
  .finally(() => { void pool.end(); });
