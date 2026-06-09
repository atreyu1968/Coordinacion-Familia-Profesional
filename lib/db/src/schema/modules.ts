import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const modulesTable = pgTable("modules", {
  id: serial("id").primaryKey(),
  code: text("code"),
  name: text("name").notNull(),
  cycleName: text("cycle_name"),
  centerId: integer("center_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Module = typeof modulesTable.$inferSelect;
export type InsertModule = typeof modulesTable.$inferInsert;
