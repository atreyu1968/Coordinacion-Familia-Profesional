import { pgTable, integer, serial, text, timestamp, boolean, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { eventsTable } from "./events";
import { usersTable } from "./users";

export const meetingMinutesTable = pgTable("meeting_minutes", {
  eventId: integer("event_id").primaryKey().references(() => eventsTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  revision: integer("revision").notNull().default(0),
  draftText: text("draft_text").notNull().default(""),
  publishedText: text("published_text"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: integer("published_by").references(() => usersTable.id, { onDelete: "set null" }),
  generationStatus: text("generation_status").notNull().default("idle"),
  generationError: text("generation_error"),
  generationInstructions: text("generation_instructions"),
  generationRevision: integer("generation_revision"),
  generationRequestedBy: integer("generation_requested_by").references(() => usersTable.id, { onDelete: "set null" }),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const meetingMinutesSourcesTable = pgTable("meeting_minutes_sources", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => meetingMinutesTable.eventId, { onDelete: "cascade" }),
  objectPath: text("object_path").notNull().unique(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  purpose: text("purpose").notNull().default("evidence"),
  status: text("status").notNull().default("queued"),
  extractedText: text("extracted_text").notNull().default(""),
  error: text("error"),
  consentBy: integer("consent_by").references(() => usersTable.id, { onDelete: "set null" }),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const meetingMinutesSharedDocumentsTable = pgTable("meeting_minutes_shared_documents", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => meetingMinutesTable.eventId, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  objectPath: text("object_path").unique(),
  url: text("url"),
  fileName: text("file_name"),
  contentType: text("content_type"),
  size: integer("size"),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, (table) => [
  index("meeting_minutes_shared_documents_event_idx").on(table.eventId, table.createdAt),
  check("meeting_minutes_shared_documents_kind_check", sql`
    (${table.kind} = 'file' AND ${table.objectPath} IS NOT NULL AND ${table.url} IS NULL
      AND ${table.fileName} IS NOT NULL AND ${table.contentType} IS NOT NULL AND ${table.size} > 0)
    OR (${table.kind} = 'link' AND ${table.objectPath} IS NULL AND ${table.url} IS NOT NULL
      AND ${table.fileName} IS NULL AND ${table.contentType} IS NULL AND ${table.size} IS NULL)
  `),
]);
export const meetingMinutesMessagesTable = pgTable("meeting_minutes_messages", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => meetingMinutesTable.eventId, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const meetingAiSettingsTable = pgTable("meeting_ai_settings", {
  id: integer("id").primaryKey().default(1),
  apiKey: text("api_key"),
  transcriptionModel: text("transcription_model").notNull().default("gpt-4o-mini-transcribe"),
  visionModel: text("vision_model").notNull().default("gpt-5.4-mini"),
});
export const insertMeetingMinutesSchema = createInsertSchema(meetingMinutesTable);
export const insertMeetingMinutesSourceSchema = createInsertSchema(meetingMinutesSourcesTable);
export const insertMeetingMinutesSharedDocumentSchema = createInsertSchema(meetingMinutesSharedDocumentsTable);
export const insertMeetingMinutesMessageSchema = createInsertSchema(meetingMinutesMessagesTable);
export const insertMeetingAiSettingsSchema = createInsertSchema(meetingAiSettingsTable);
export type MeetingMinutesRow = typeof meetingMinutesTable.$inferSelect;
export type MinutesSourceRow = typeof meetingMinutesSourcesTable.$inferSelect;
export type MinutesSharedDocumentRow = typeof meetingMinutesSharedDocumentsTable.$inferSelect;
