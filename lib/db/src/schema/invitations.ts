import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { roleEnum } from "./enums";

export const invitationsTable = pgTable("invitations", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  role: roleEnum("role").notNull(),
  provinceId: integer("province_id"),
  centerId: integer("center_id"),
  status: text("status").notNull().default("pending"),
  invitedBy: integer("invited_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Invitation = typeof invitationsTable.$inferSelect;
export type InsertInvitation = typeof invitationsTable.$inferInsert;
