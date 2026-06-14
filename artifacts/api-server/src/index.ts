import http from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { initRealtime } from "./lib/realtime";
import { seedIntegrationSettingsFromEnv } from "./lib/settings";
import { seedAcademicYears } from "./routes/academicYears";
import { startConfirmationScheduler } from "./lib/scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
initRealtime(server);

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

async function start(): Promise<void> {
  try {
    await seedIntegrationSettingsFromEnv();
  } catch (err) {
    logger.error(
      { err },
      "Failed to seed integration settings from environment",
    );
  }
  try {
    await seedAcademicYears();
  } catch (err) {
    logger.error({ err }, "Failed to seed academic years");
  }
  startConfirmationScheduler();
  server.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

void start();
