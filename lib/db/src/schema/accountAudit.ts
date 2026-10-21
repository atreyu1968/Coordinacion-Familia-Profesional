import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { User } from "./users";

export type AccountAuditField = "name" | "role" | "centerId" | "provinceId" | "status";
export type AccountAuditChange = { field: AccountAuditField; before: string | null; after: string | null };

// Independent snapshots: no cascading foreign keys, no historical backfill.
export const accountAuditTable = pgTable("account_audit", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  targetId: integer("target_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  action: text("action").$type<"update" | "deactivate" | "reactivate">().notNull(),
  changes: jsonb("changes").$type<AccountAuditChange[]>().notNull(),
  beforeProvinceId: integer("before_province_id"),
  afterProvinceId: integer("after_province_id"),
  beforeCenterId: integer("before_center_id"),
  afterCenterId: integer("after_center_id"),
  beforeRole: text("before_role").$type<User["role"]>().notNull(),
  afterRole: text("after_role").$type<User["role"]>().notNull(),
}, (t) => [index("account_audit_target_id_id_idx").on(t.targetId, t.id)]);
