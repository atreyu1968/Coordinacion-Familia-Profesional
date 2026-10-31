import { pgTable, integer, text, boolean, timestamp, jsonb, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { modulesTable } from "./modules";
import { usersTable } from "./users";
import { forumThreadsTable } from "./forums";
import { moduleLearningOutcomesTable, moduleEvaluationCriteriaTable } from "./learningOutcomes";

export type ProgrammingSection = { key: string; title: string; prompt: string; enabled: boolean; order: number };

export const forumCollaborationsTable = pgTable("forum_collaborations", {
  moduleId: integer("module_id").primaryKey().references(() => modulesTable.id),
  enabled: boolean("enabled").notNull().default(false),
  officialCode: text("official_code").notNull(),
  sourceTitle: text("source_title").notNull(),
  sourceUrl: text("source_url").notNull(),
  curriculumVersion: text("curriculum_version").notNull(),
  territory: text("territory").notNull(),
  fingerprint: text("fingerprint").notNull(),
  revision: integer("revision").notNull().default(1),
  sections: jsonb("sections").$type<ProgrammingSection[]>().notNull(),
  verifiedBy: integer("verified_by").references(() => usersTable.id, { onDelete: "set null" }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
});

export const forumCollaborationRevisionsTable = pgTable("forum_collaboration_revisions", {
  moduleId: integer("module_id").notNull().references(() => forumCollaborationsTable.moduleId),
  revision: integer("revision").notNull(),
  configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.moduleId, t.revision] })]);

// Context is separate so legacy threads keep their schema and remain general
// debates without an inferred classification.
export const forumThreadContextsTable = pgTable("forum_thread_contexts", {
  threadId: integer("thread_id").primaryKey().references(() => forumThreadsTable.id, { onDelete: "cascade" }),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id),
  kind: text("kind").notNull(),
  stableKey: text("stable_key").notNull(),
  outcomeId: integer("outcome_id").references(() => moduleLearningOutcomesTable.id),
  criterionId: integer("criterion_id").references(() => moduleEvaluationCriteriaTable.id),
  templateVersion: integer("template_version").notNull(),
  curriculumVersion: text("curriculum_version").notNull(),
}, t => [uniqueIndex("forum_thread_context_module_key_uq").on(t.moduleId, t.stableKey)]);
