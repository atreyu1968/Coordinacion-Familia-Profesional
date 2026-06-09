import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const integrationSettingsTable = pgTable("integration_settings", {
  id: serial("id").primaryKey(),
  deepseekApiKey: text("deepseek_api_key"),
  resendApiKey: text("resend_api_key"),
  resendFromEmail: text("resend_from_email"),
  vapidPublicKey: text("vapid_public_key"),
  vapidPrivateKey: text("vapid_private_key"),
  vapidSubject: text("vapid_subject"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type IntegrationSettings = typeof integrationSettingsTable.$inferSelect;
export type InsertIntegrationSettings =
  typeof integrationSettingsTable.$inferInsert;
