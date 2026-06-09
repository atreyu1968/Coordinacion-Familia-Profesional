import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const companyAlertsTable = pgTable("company_alerts", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull(),
  sector: text("sector"),
  location: text("location"),
  positions: integer("positions"),
  description: text("description"),
  contact: text("contact"),
  provinceId: integer("province_id"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type CompanyAlert = typeof companyAlertsTable.$inferSelect;
export type InsertCompanyAlert = typeof companyAlertsTable.$inferInsert;
