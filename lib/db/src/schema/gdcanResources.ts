import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const gdcanResourcesTable = pgTable("gdcan_resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  url: text("url"),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type GdcanResource = typeof gdcanResourcesTable.$inferSelect;
export type InsertGdcanResource = typeof gdcanResourcesTable.$inferInsert;
