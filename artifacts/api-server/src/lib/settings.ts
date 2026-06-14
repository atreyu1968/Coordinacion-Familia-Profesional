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

// Professional family the app instance is destined for. Used both as an identity
// string (login/emails/AI prompts) and to scope the centers data view. Falls back
// to the founding family when the control panel leaves it unset.
export const DEFAULT_PROFESSIONAL_FAMILY = "Administración y Gestión";

export function professionalFamilyOf(s: IntegrationSettings): string {
  const fam = (s.professionalFamily ?? "").trim();
  return fam || DEFAULT_PROFESSIONAL_FAMILY;
}

// The single professional family the whole app instance is locked to. Used to
// restrict the centers data view (and the center-derived dashboard/report
// figures) to that family for every user.
export async function getActiveFamily(): Promise<string> {
  return professionalFamilyOf(await getSettings());
}

// The academic year (course) the app currently operates on. Used to default the
// year filter for groups/teaching-assignments/training-offer and the academic
// dashboard/report figures. Returns null when no course has been activated yet.
export async function getActiveAcademicYear(): Promise<string | null> {
  const value = ((await getSettings()).activeAcademicYear ?? "").trim();
  return value || null;
}

export function isDeepseekConfigured(s: IntegrationSettings): boolean {
  return typeof s.deepseekApiKey === "string" && s.deepseekApiKey.length > 0;
}

export function isResendConfigured(s: IntegrationSettings): boolean {
  return typeof s.resendApiKey === "string" && s.resendApiKey.length > 0;
}

export { isJaasConfigured } from "./jaas";
export { isNextcloudConfigured } from "./nextcloud";
