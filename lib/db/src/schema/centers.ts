import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

export const centersTable = pgTable("centers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  provinceId: integer("province_id"),
  islandId: integer("island_id"),
  municipalityId: integer("municipality_id"),
  address: text("address"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Center = typeof centersTable.$inferSelect;
export type InsertCenter = typeof centersTable.$inferInsert;
