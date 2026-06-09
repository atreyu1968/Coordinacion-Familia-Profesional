import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const municipalitiesTable = pgTable("municipalities", {
  id: serial("id").primaryKey(),
  islandId: integer("island_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Municipality = typeof municipalitiesTable.$inferSelect;
export type InsertMunicipality = typeof municipalitiesTable.$inferInsert;
