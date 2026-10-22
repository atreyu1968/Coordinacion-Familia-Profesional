import { createInsertSchema } from "drizzle-zod";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const coordinatorTasksTable = pgTable("coordinator_tasks", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("pending"),
  reviewStatus: text("review_status").notNull().default("accepted"),
  sourceType: text("source_type").notNull().default("manual"),
  sourceId: text("source_id"),
  sourceFingerprint: text("source_fingerprint").notNull().default(""),
  sourceLabel: text("source_label"),
  sourceDate: timestamp("source_date", { withTimezone: true }),
  resolution: text("resolution"),
  revision: integer("revision").notNull().default(1),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("coordinator_tasks_owner_status_idx").on(table.ownerId, table.status, table.updatedAt),
  index("coordinator_tasks_owner_review_idx").on(table.ownerId, table.reviewStatus, table.createdAt),
  uniqueIndex("coordinator_tasks_source_fingerprint_uq").on(
    table.ownerId,
    table.sourceType,
    table.sourceId,
    table.sourceFingerprint,
  ),
  check("coordinator_tasks_status_check", sql`${table.status} IN ('pending', 'in_progress', 'resolved')`),
  check("coordinator_tasks_review_status_check", sql`${table.reviewStatus} IN ('suggested', 'accepted', 'dismissed')`),
  check("coordinator_tasks_source_type_check", sql`${table.sourceType} IN ('manual', 'minutes', 'message', 'email')`),
]);

export const coordinatorTaskSourceScansTable = pgTable("coordinator_task_source_scans", {
  id: serial("id").primaryKey(),
  ownerId: integer("owner_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  contentHash: text("content_hash").notNull(),
  scannedAt: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("coordinator_task_source_scan_owner_source_uq").on(table.ownerId, table.sourceType, table.sourceId),
  check("coordinator_task_source_scans_type_check", sql`${table.sourceType} IN ('minutes', 'message', 'email')`),
]);

export const insertCoordinatorTaskSchema = createInsertSchema(coordinatorTasksTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type CoordinatorTask = typeof coordinatorTasksTable.$inferSelect;
export type InsertCoordinatorTask = typeof coordinatorTasksTable.$inferInsert;
