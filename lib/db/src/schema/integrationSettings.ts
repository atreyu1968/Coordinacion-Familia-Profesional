import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const integrationSettingsTable = pgTable("integration_settings", {
  id: serial("id").primaryKey(),
  deepseekApiKey: text("deepseek_api_key"),
  resendApiKey: text("resend_api_key"),
  resendFromEmail: text("resend_from_email"),
  jaasAppId: text("jaas_app_id"),
  jaasKid: text("jaas_kid"),
  jaasPrivateKey: text("jaas_private_key"),
  mobileWebUrl: text("mobile_web_url"),
  vapidPublicKey: text("vapid_public_key"),
  vapidPrivateKey: text("vapid_private_key"),
  vapidSubject: text("vapid_subject"),
  // Collaborative space (Nextcloud Drive + Collabora editor). The public URLs
  // are embedded in iframes; the admin credentials drive OCS provisioning and
  // the OIDC client pair lets Nextcloud authenticate against this app (SSO).
  nextcloudUrl: text("nextcloud_url"),
  collaboraUrl: text("collabora_url"),
  nextcloudAdminUser: text("nextcloud_admin_user"),
  nextcloudAdminPassword: text("nextcloud_admin_password"),
  nextcloudOidcClientId: text("nextcloud_oidc_client_id"),
  nextcloudOidcClientSecret: text("nextcloud_oidc_client_secret"),
  // RSA private key (PEM) used to sign OIDC id_tokens. Auto-generated on first
  // use and never returned to clients.
  oidcSigningKey: text("oidc_signing_key"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type IntegrationSettings = typeof integrationSettingsTable.$inferSelect;
export type InsertIntegrationSettings =
  typeof integrationSettingsTable.$inferInsert;
