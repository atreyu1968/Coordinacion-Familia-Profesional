import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  centerId: integer("center_id").notNull(),
  name: text("name").notNull(),
  headUserId: integer("head_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Department = typeof departmentsTable.$inferSelect;
export type InsertDepartment = typeof departmentsTable.$inferInsert;
