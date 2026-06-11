import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

// Global catalog of training cycles (ciclos formativos). Managed only by the
// superadmin and reused across the app: modules belong to a cycle, and each
// center declares which cycles it offers (training_offer). `cycleName` columns
// elsewhere are kept for display/back-compat and populated from this catalog.
export const cyclesTable = pgTable("cycles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  level: text("level"), // e.g. "Grado Medio" | "Grado Superior"
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Cycle = typeof cyclesTable.$inferSelect;
export type InsertCycle = typeof cyclesTable.$inferInsert;
