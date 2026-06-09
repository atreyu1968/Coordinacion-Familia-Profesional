import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const islandsTable = pgTable("islands", {
  id: serial("id").primaryKey(),
  provinceId: integer("province_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Island = typeof islandsTable.$inferSelect;
export type InsertIsland = typeof islandsTable.$inferInsert;
