import { eq } from "drizzle-orm";
import { db, integrationSettingsTable } from "@workspace/db";
import type { IntegrationSettings } from "@workspace/db";
import { logger } from "./logger";

export async function getSettings(): Promise<IntegrationSettings> {
  const [existing] = await db.select().from(integrationSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(integrationSettingsTable)
    .values({})
    .returning();
  return created;
}

/**
 * On self-hosted installs the deploy scripts write the collaborative space
 * connection details into the api-server's environment (NEXTCLOUD_URL,
 * COLLABORA_URL, admin user/password, OIDC client id/secret). The resolve*
 * helpers already fall back to those env vars, but the control panel reads the
 * raw DB row — so without this seed the admin sees empty fields and thinks the
 * integration was not saved. This backfills the DB from the environment for any
 * collaborative-space field that is still empty, making the panel reflect (and
 * let the admin edit) the auto-installed configuration. DB values always win, so
 * once set in the panel they are never overwritten from the environment.
 */
export async function seedIntegrationSettingsFromEnv(): Promise<void> {
  const settings = await getSettings();
  const envClean = (key: string): string => (process.env[key] || "").trim();
  const envUrl = (key: string): string => envClean(key).replace(/\/+$/, "");

  const updates: Record<string, string> = {};
  const fill = (field: keyof IntegrationSettings, value: string): void => {
    const existing = ((settings[field] as string | null) ?? "").trim();
    if (value && !existing) updates[field as string] = value;
  };

  fill("nextcloudUrl", envUrl("NEXTCLOUD_URL"));
  fill("collaboraUrl", envUrl("COLLABORA_URL"));
  fill("nextcloudAdminUser", envClean("NEXTCLOUD_ADMIN_USER"));
  fill("nextcloudAdminPassword", envClean("NEXTCLOUD_ADMIN_PASSWORD"));
  fill("nextcloudOidcClientId", envClean("NEXTCLOUD_OIDC_CLIENT_ID"));
  fill("nextcloudOidcClientSecret", envClean("NEXTCLOUD_OIDC_CLIENT_SECRET"));

  if (Object.keys(updates).length === 0) return;

  await db
    .update(integrationSettingsTable)
    .set(updates as Partial<typeof integrationSettingsTable.$inferInsert>)
    .where(eq(integrationSettingsTable.id, settings.id));
  logger.info(
    { fields: Object.keys(updates) },
    "Seeded collaborative space settings from environment",
  );
}

export function isDeepseekConfigured(s: IntegrationSettings): boolean {
  return typeof s.deepseekApiKey === "string" && s.deepseekApiKey.length > 0;
}

export function isResendConfigured(s: IntegrationSettings): boolean {
  return typeof s.resendApiKey === "string" && s.resendApiKey.length > 0;
}

export { isJaasConfigured } from "./jaas";
export { isNextcloudConfigured } from "./nextcloud";
