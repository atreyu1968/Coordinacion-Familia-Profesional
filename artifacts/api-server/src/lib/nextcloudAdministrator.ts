import { db, usersTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSettings } from "./settings";
import { resolveNextcloudConfig, resolveNextcloudUrl, syncNextcloudAdministrator } from "./nextcloud";
import { logger } from "./logger";

export class NextcloudAdminRevocationError extends Error {}

/** Lock the same account row used by role changes so a stale SSO cannot
 * re-grant administration after a completed demotion. */
export async function syncNextcloudAdministratorForSso(expected: User): Promise<void> {
  const config = resolveNextcloudConfig(await getSettings());
  if (!config) throw new Error("La conexión administrativa de Nextcloud no está configurada.");
  await db.transaction(async tx => {
    const [current] = await tx.select().from(usersTable)
      .where(eq(usersTable.id, expected.id)).for("update");
    if (!current || current.status !== "active" || current.deletedAt || current.role !== expected.role) {
      throw new Error("La cuenta ha cambiado. Vuelve a abrir Nextcloud desde la aplicación.");
    }
    await syncNextcloudAdministrator(config, current);
  });
}

/** Called inside the account-change transaction. A failed remote revocation
 * rolls back the local demotion; an already revoked remote grant is never
 * restored automatically on a failed transaction. */
export async function revokeNextcloudAdministrator(before: User, after: User): Promise<void> {
  if (before.role !== "superadmin"
    || (after.role === "superadmin" && after.status === "active" && !after.deletedAt)) return;
  try {
    const settings = await getSettings();
    const config = resolveNextcloudConfig(settings);
    if (!config) {
      if (resolveNextcloudUrl(settings)) throw new Error("Faltan las credenciales administrativas de Nextcloud.");
      return; // No configured Nextcloud integration to reconcile.
    }
    await syncNextcloudAdministrator(config, after);
  } catch {
    logger.warn({ userId: before.id }, "Nextcloud administrator revocation could not be confirmed");
    throw new NextcloudAdminRevocationError("No se pudo confirmar la retirada de permisos de administrador en Nextcloud. No se ha aplicado el cambio de cuenta. Revisa la integración y reintenta.");
  }
}
