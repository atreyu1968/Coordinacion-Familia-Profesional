import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const groupsTable = pgTable("groups", {
  id: serial("id").primaryKey(),
  centerId: integer("center_id").notNull(),
  name: text("name").notNull(),
  cycleName: text("cycle_name"),
  schoolYear: text("school_year"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Group = typeof groupsTable.$inferSelect;
export type InsertGroup = typeof groupsTable.$inferInsert;
