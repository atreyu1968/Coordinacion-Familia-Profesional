import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { forumThreadsTable } from "./forums";
import { modulesTable } from "./modules";
import { usersTable } from "./users";
import { centersTable } from "./centers";
import { wikiPagesTable } from "./wikiPages";

export const forumAgreementsTable = pgTable("forum_agreements", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => forumThreadsTable.id),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id),
  status: text("status").notNull().default("abierto"),
  revision: integer("revision").notNull().default(1),
  version: integer("version").notNull().default(1),
  summary: text("summary").notNull().default(""),
  proposedText: text("proposed_text").notNull().default(""),
  observations: text("observations").notNull().default(""),
  closureReason: text("closure_reason").notNull().default(""),
  sources: jsonb("sources").$type<{ title: string; url: string }[]>().notNull().default([]),
  sourcePostIds: jsonb("source_post_ids").$type<number[]>().notNull().default([]),
  editorIds: jsonb("editor_ids").$type<number[]>().notNull().default([]),
  electorateIds: jsonb("electorate_ids").$type<number[]>().notNull().default([]),
  documentUrl: text("document_url"),
  fingerprint: text("fingerprint").notNull(),
  curriculumVersion: text("curriculum_version").notNull(),
  publishedPageId: integer("published_page_id").references(() => wikiPagesTable.id),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedBy: integer("updated_by").references(() => usersTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("forum_agreements_thread_uq").on(t.threadId), index("forum_agreements_module_status_idx").on(t.moduleId, t.status)]);

export const forumAgreementRevisionsTable = pgTable("forum_agreement_revisions", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => forumAgreementsTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  publishedPageId: integer("published_page_id").references(() => wikiPagesTable.id),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("forum_agreement_revision_uq").on(t.agreementId, t.revision),
  index("forum_agreement_published_page_idx").on(t.publishedPageId)]);

export const forumAgreementPositionsTable = pgTable("forum_agreement_positions", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => forumAgreementsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  centerId: integer("center_id").references(() => centersTable.id, { onDelete: "set null" }),
  centerName: text("center_name").notNull(),
  position: text("position").notNull(),
  reason: text("reason").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("forum_agreement_position_user_version_uq").on(t.agreementId, t.version, t.userId)]);

export const forumAgreementPositionHistoryTable = pgTable("forum_agreement_position_history", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => forumAgreementsTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  centerId: integer("center_id").references(() => centersTable.id, { onDelete: "set null" }),
  centerName: text("center_name").notNull(),
  position: text("position").notNull(),
  reason: text("reason").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("forum_agreement_position_history_idx").on(t.agreementId, t.version)]);
