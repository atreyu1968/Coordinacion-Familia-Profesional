import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const provincesTable = pgTable("provinces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Province = typeof provincesTable.$inferSelect;
export type InsertProvince = typeof provincesTable.$inferInsert;
