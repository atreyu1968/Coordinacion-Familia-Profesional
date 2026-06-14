import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// Official list of academic years (cursos académicos), e.g. "2024/2025".
// The course is still stored as free text (the year name) elsewhere
// (groups.schoolYear, teaching_assignments.schoolYear, training_offer.schoolYear)
// and this table is the authoritative list backing those values.
export const academicYearsTable = pgTable("academic_years", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AcademicYear = typeof academicYearsTable.$inferSelect;
export type InsertAcademicYear = typeof academicYearsTable.$inferInsert;
