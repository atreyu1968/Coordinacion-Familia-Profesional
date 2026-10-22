// This executable is test-only; never imported by the production API.
import { realpathSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:https";
import express from "express";
import { eq, sql } from "drizzle-orm";

const root = process.env.COORDINA_PROFILE_UI_ROOT;
if (!root || !/\/coordina-profile-ui\.[a-zA-Z0-9]+$/.test(root) || realpathSync(root) !== root) {
  throw new Error("Use bash scripts/test-profile-ui.sh; shared databases are forbidden.");
}
const url = new URL(process.env.DATABASE_URL ?? "");
if (url.pathname !== "/coordina_profile_ui" || url.searchParams.get("host") !== join(root, "socket")) {
  throw new Error("Refusing a database outside the disposable private socket.");
}
const { db, pool, integrationSettingsTable } = await import("@workspace/db");
const identity = await db.execute(sql`
  SELECT current_database() AS name, current_setting('data_directory') AS directory,
         current_setting('listen_addresses') AS listeners
`);
const row = identity.rows[0];
if (row.name !== "coordina_profile_ui" || row.directory !== join(root, "data") || row.listeners !== "") {
  await pool.end();
  throw new Error("PostgreSQL identity does not match the disposable runner.");
}

// Only after verifying the server's identity may fixtures or app code run.
const { getSettings } = await import("../src/lib/settings");
const { createProvince, createCenter, createModule, createUser } = await import("../test/helpers");
const settings = await getSettings();
const year = "2098-2099";
await db.update(integrationSettingsTable).set({ activeAcademicYear: year })
  .where(eq(integrationSettingsTable.id, settings.id));
const provinceId = await createProvince("Provincia UI sintética");
const centerId = await createCenter(provinceId);
const moduleName = "Módulo UI sintético";
const moduleId = await createModule({ centerId, name: moduleName });
const { centersTable } = await import("@workspace/db");
const [center] = await db.select().from(centersTable).where(eq(centersTable.id, centerId));
const accounts: Record<string, { email: string; password: string; id: number }> = {};
for (const surface of ["desktop", "mobile"]) {
  for (const role of ["teacher", "department_head", "coordinator", "superadmin"] as const) {
    for (const state of ["no-center", "no-modules"]) {
      const account = await createUser({
        role, incompleteProfile: true, provinceId,
        centerId: state === "no-center" ? null : centerId,
        name: `UI ${surface} ${role} ${state}`,
      });
      accounts[`${surface}/${role}/${state}`] = {
        email: account.email, password: account.password, id: account.user.id,
      };
    }
  }
}
const api = (await import("../src/app")).default;
const { initRealtime } = await import("../src/lib/realtime");
const certificates = {
  key: readFileSync(join(root, "key.pem")),
  cert: readFileSync(join(root, "cert.pem")),
};
const servers: ReturnType<typeof createServer>[] = [];
for (const [client, origin] of [
  ["web", process.env.PROFILE_UI_WEB_URL],
  ["mobile", process.env.PROFILE_UI_MOBILE_URL],
] as const) {
  const parsed = new URL(origin!);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "https:") {
    throw new Error("The browser fixtures must use loopback HTTPS only.");
  }
  const app = express();
  app.use(api);
  app.use(express.static(join(root, client)));
  app.get("/{*path}", (_req, res) => res.sendFile(join(root, client, "index.html")));
  const server = createServer(certificates, app);
  // Profile saves reconnect Socket.io; exercise the real handshake as well.
  initRealtime(server);
  await new Promise<void>(resolve => server.listen(Number(parsed.port), "127.0.0.1", resolve));
  servers.push(server);
}
writeFileSync(join(root, "ready.json"), JSON.stringify({
  accounts, centerId, centerName: center.name, provinceId, moduleId, moduleName, year,
}));
const stop = async () => {
  for (const server of servers) server.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
