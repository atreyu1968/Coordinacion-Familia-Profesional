import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// Mandatory annual confirmation: when a new academic year is opened, each
// teacher must reconfirm the center and modules they will teach that year.
// status is "pending" until they confirm; deadline is 15 days after the window
// opens; an overdue pending row triggers automatic account deactivation.
export const teacherYearConfirmationsTable = pgTable(
  "teacher_year_confirmations",
  {
    id: serial("id").primaryKey(),
    teacherId: integer("teacher_id").notNull(),
    schoolYear: text("school_year").notNull(),
    status: text("status").notNull().default("pending"),
    centerId: integer("center_id"),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type TeacherYearConfirmation =
  typeof teacherYearConfirmationsTable.$inferSelect;
export type InsertTeacherYearConfirmation =
  typeof teacherYearConfirmationsTable.$inferInsert;
