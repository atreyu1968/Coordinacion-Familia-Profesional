import { db, integrationSettingsTable } from "@workspace/db";
import type { IntegrationSettings } from "@workspace/db";

export async function getSettings(): Promise<IntegrationSettings> {
  const [existing] = await db.select().from(integrationSettingsTable).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(integrationSettingsTable)
    .values({})
    .returning();
  return created;
}

export function isDeepseekConfigured(s: IntegrationSettings): boolean {
  return typeof s.deepseekApiKey === "string" && s.deepseekApiKey.length > 0;
}

export function isResendConfigured(s: IntegrationSettings): boolean {
  return typeof s.resendApiKey === "string" && s.resendApiKey.length > 0;
}

export { isJaasConfigured } from "./jaas";
