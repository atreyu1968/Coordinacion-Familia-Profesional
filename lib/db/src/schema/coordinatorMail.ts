import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, integer, text, bigint, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const coordinatorMailSettingsTable = pgTable("coordinator_mail_settings", {
  id: integer("id").primaryKey().default(1),
  googleClientId: text("google_client_id"),
  googleClientSecretEncrypted: text("google_client_secret_encrypted"),
  googleRedirectUri: text("google_redirect_uri"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const coordinatorMailAccountsTable = pgTable("coordinator_mail_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email"),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  oauthStateHash: text("oauth_state_hash"),
  oauthCookieHash: text("oauth_cookie_hash"),
  oauthVerifierEncrypted: text("oauth_verifier_encrypted"),
  oauthExpiresAt: timestamp("oauth_expires_at", { withTimezone: true }),
  syncStatus: text("sync_status").notNull().default("idle"),
  syncError: text("sync_error"),
  syncPageToken: text("sync_page_token"),
  syncQuery: text("sync_query"),
  syncLeaseUntil: timestamp("sync_lease_until", { withTimezone: true }),
  nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  syncMessagesImported: integer("sync_messages_imported").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("coordinator_mail_accounts_user_uq").on(t.userId)]);
export const coordinatorMailAccountInsertSchema = createInsertSchema(coordinatorMailAccountsTable).omit({ id: true, createdAt: true, updatedAt: true });

export const coordinatorMailCaseGroupsTable = pgTable("coordinator_mail_case_groups", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("coordinator_mail_case_group_owner_idx").on(t.ownerId)]);

export const coordinatorMailCasesTable = pgTable("coordinator_mail_cases", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => coordinatorMailCaseGroupsTable.id, { onDelete: "set null" }),
  gmailThreadId: text("gmail_thread_id"),
  title: text("title").notNull(),
  status: text("status").notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  draftTo: text("draft_to").notNull().default(""),
  draftSubject: text("draft_subject").notNull().default(""),
  draftBody: text("draft_body").notNull().default(""),
  aiStatus: text("ai_status").notNull().default("idle"),
  aiError: text("ai_error"),
  aiInstructions: text("ai_instructions"),
  aiConsentAt: timestamp("ai_consent_at", { withTimezone: true }),
  aiRevision: integer("ai_revision"),
  aiRequestedBy: integer("ai_requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  aiLeaseToken: text("ai_lease_token"),
  aiLeaseUntil: timestamp("ai_lease_until", { withTimezone: true }),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("coordinator_mail_case_thread_uq").on(t.ownerId, t.gmailThreadId),
  index("coordinator_mail_case_owner_activity_idx").on(t.ownerId, t.lastActivityAt),
  index("coordinator_mail_case_group_idx").on(t.ownerId, t.groupId),
]);
export const coordinatorMailCaseInsertSchema = createInsertSchema(coordinatorMailCasesTable).omit({ id: true, createdAt: true, updatedAt: true });

export const coordinatorMailCaseThreadsTable = pgTable("coordinator_mail_case_threads", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").notNull().references(() => coordinatorMailCasesTable.id, { onDelete: "cascade" }),
  gmailThreadId: text("gmail_thread_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("coordinator_mail_case_thread_map_uq").on(t.ownerId, t.gmailThreadId),
  index("coordinator_mail_case_thread_case_idx").on(t.caseId),
]);

export const coordinatorMailMessagesTable = pgTable("coordinator_mail_messages", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  caseId: integer("case_id").notNull().references(() => coordinatorMailCasesTable.id, { onDelete: "cascade" }),
  gmailThreadId: text("gmail_thread_id"),
  gmailMessageId: text("gmail_message_id").notNull(),
  rfcMessageId: text("rfc_message_id"),
  direction: text("direction").notNull().default("received"),
  senderEmail: text("sender_email").notNull(),
  senderName: text("sender_name").notNull().default(""),
  toEmails: text("to_emails").notNull().default(""),
  ccEmails: text("cc_emails").notNull().default(""),
  subject: text("subject").notNull().default(""),
  bodyText: text("body_text").notNull().default(""),
  bodyTruncated: boolean("body_truncated").notNull().default(false),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("coordinator_mail_message_google_uq").on(t.ownerId, t.gmailMessageId),
  index("coordinator_mail_message_case_received_idx").on(t.caseId, t.receivedAt),
]);
export const coordinatorMailMessageInsertSchema = createInsertSchema(coordinatorMailMessagesTable).omit({ id: true, createdAt: true });

export const coordinatorMailAttachmentsTable = pgTable("coordinator_mail_attachments", {
  id: serial("id").primaryKey(),
  messageId: integer("message_id").notNull().references(() => coordinatorMailMessagesTable.id, { onDelete: "cascade" }),
  providerAttachmentId: text("provider_attachment_id").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  objectPath: text("object_path"),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("coordinator_mail_attachment_provider_uq").on(t.messageId, t.providerAttachmentId),
  index("coordinator_mail_attachment_path_idx").on(t.objectPath),
]);
export const coordinatorMailAttachmentInsertSchema = createInsertSchema(coordinatorMailAttachmentsTable).omit({ id: true, createdAt: true });

export const coordinatorMailCaseNotesTable = pgTable("coordinator_mail_case_notes", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => coordinatorMailCasesTable.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("note"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("coordinator_mail_note_case_created_idx").on(t.caseId, t.createdAt)]);
export const coordinatorMailCaseNoteInsertSchema = createInsertSchema(coordinatorMailCaseNotesTable).omit({ id: true, createdAt: true });

export const coordinatorMailOutboxTable = pgTable("coordinator_mail_outbox", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => coordinatorMailCasesTable.id, { onDelete: "cascade" }),
  gmailMessageId: integer("gmail_message_id").references(() => coordinatorMailMessagesTable.id, { onDelete: "set null" }),
  revision: integer("revision").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text").notNull(),
  status: text("status").notNull().default("queued"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  deliveryMessageId: text("delivery_message_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("coordinator_mail_outbox_revision_uq").on(t.caseId, t.revision),
  uniqueIndex("coordinator_mail_outbox_delivery_uq").on(t.deliveryMessageId),
  index("coordinator_mail_outbox_status_created_idx").on(t.status, t.createdAt),
]);
export const coordinatorMailOutboxInsertSchema = createInsertSchema(coordinatorMailOutboxTable).omit({ id: true, createdAt: true });

export type CoordinatorMailAccount = typeof coordinatorMailAccountsTable.$inferSelect;
export type CoordinatorMailCase = typeof coordinatorMailCasesTable.$inferSelect;
export type CoordinatorMailMessage = typeof coordinatorMailMessagesTable.$inferSelect;
export type CoordinatorMailAttachment = typeof coordinatorMailAttachmentsTable.$inferSelect;
export type CoordinatorMailCaseNote = typeof coordinatorMailCaseNotesTable.$inferSelect;
export type CoordinatorMailOutbox = typeof coordinatorMailOutboxTable.$inferSelect;
