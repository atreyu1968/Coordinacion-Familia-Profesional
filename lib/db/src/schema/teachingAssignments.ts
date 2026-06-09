import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const teachingAssignmentsTable = pgTable("teaching_assignments", {
  id: serial("id").primaryKey(),
  teacherId: integer("teacher_id").notNull(),
  moduleId: integer("module_id").notNull(),
  groupId: integer("group_id"),
  centerId: integer("center_id").notNull(),
  schoolYear: text("school_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type TeachingAssignment = typeof teachingAssignmentsTable.$inferSelect;
export type InsertTeachingAssignment =
  typeof teachingAssignmentsTable.$inferInsert;
