import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { modulesTable } from "./modules";

// Learning outcomes (Resultados de Aprendizaje, "RA") of a module. Codes are
// entered manually following the relevant curricular legislation (e.g. "RA1").
// Each outcome has its own evaluation criteria (see evaluationCriteria). Modeled
// with their own table/FK so they can be reused later in assessments/reports.
export const moduleLearningOutcomesTable = pgTable("module_learning_outcomes", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id")
    .notNull()
    .references(() => modulesTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  description: text("description").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ModuleLearningOutcome =
  typeof moduleLearningOutcomesTable.$inferSelect;
export type InsertModuleLearningOutcome =
  typeof moduleLearningOutcomesTable.$inferInsert;

// Evaluation criteria (Criterios de Evaluación, "CE") belonging to a single
// learning outcome. Codes are entered manually following legislation (e.g.
// "a", "b" or "RA1.a").
export const moduleEvaluationCriteriaTable = pgTable(
  "module_evaluation_criteria",
  {
    id: serial("id").primaryKey(),
    outcomeId: integer("outcome_id")
      .notNull()
      .references(() => moduleLearningOutcomesTable.id, {
        onDelete: "cascade",
      }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    order: integer("order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
);

export type ModuleEvaluationCriterion =
  typeof moduleEvaluationCriteriaTable.$inferSelect;
export type InsertModuleEvaluationCriterion =
  typeof moduleEvaluationCriteriaTable.$inferInsert;
