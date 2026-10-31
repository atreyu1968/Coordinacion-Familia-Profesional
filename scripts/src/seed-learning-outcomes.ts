import { db, pool } from "@workspace/db";
import {
  logLearningOutcomesSeedStats,
  seedLearningOutcomesCatalog,
} from "./lib/seed-learning-outcomes";

db.transaction(seedLearningOutcomesCatalog)
  .then(logLearningOutcomesSeedStats)
  .catch((error) => {
    console.error("No se pudo cargar el currículo RA/CE:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
