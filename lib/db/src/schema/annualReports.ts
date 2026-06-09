import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const annualReportsTable = pgTable("annual_reports", {
  id: serial("id").primaryKey(),
  schoolYear: text("school_year").notNull(),
  provinceId: integer("province_id"),
  content: text("content").notNull(),
  status: text("status").notNull().default("draft"), // draft | final
  generatedById: integer("generated_by_id"),
  generatedAt: timestamp("generated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AnnualReport = typeof annualReportsTable.$inferSelect;
export type InsertAnnualReport = typeof annualReportsTable.$inferInsert;
