import { pgTable, integer, text, boolean, timestamp, serial, uniqueIndex, index } from "drizzle-orm/pg-core";
import { resourcesTable } from "./resources";
import { modulesTable } from "./modules";
import { centersTable } from "./centers";
import { moduleLearningOutcomesTable, moduleEvaluationCriteriaTable } from "./learningOutcomes";

export const resourceCurriculumTable = pgTable("resource_curriculum", {
  resourceId: integer("resource_id").primaryKey().references(() => resourcesTable.id, { onDelete: "cascade" }),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id),
  originCenterId: integer("origin_center_id").references(() => centersTable.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  canonicalKey: text("canonical_key").notNull(),
  license: text("license").notNull(),
  version: text("version").notNull(),
  audience: text("audience").notNull(),
  restricted: boolean("restricted").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  curriculumVersion: text("curriculum_version").notNull(),
  fingerprint: text("fingerprint").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("resource_curriculum_canonical_uq").on(t.canonicalKey), index("resource_curriculum_module_idx").on(t.moduleId)]);

export const resourceLearningTargetsTable = pgTable("resource_learning_targets", {
  id: serial("id").primaryKey(),
  resourceId: integer("resource_id").notNull().references(() => resourceCurriculumTable.resourceId, { onDelete: "cascade" }),
  outcomeId: integer("outcome_id").notNull().references(() => moduleLearningOutcomesTable.id),
  criterionId: integer("criterion_id").references(() => moduleEvaluationCriteriaTable.id),
  stableKey: text("stable_key").notNull(),
}, t => [uniqueIndex("resource_learning_targets_key_uq").on(t.resourceId, t.stableKey),
  index("resource_learning_targets_outcome_idx").on(t.outcomeId), index("resource_learning_targets_criterion_idx").on(t.criterionId)]);
