import { pgTable, integer, serial, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const aiKnowledgeAccountsTable = pgTable("ai_knowledge_accounts", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  scannedAt: timestamp("scanned_at", { withTimezone: true }),
  scanError: text("scan_error"),
});

export const aiKnowledgeEntriesTable = pgTable("ai_knowledge_entries", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sourceKey: text("source_key").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  version: text("version").notNull(),
  text: text("text").notNull().default(""),
  status: text("status").notNull().default("pending"),
  warning: text("warning"),
  leaseToken: text("lease_token"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({
  source: uniqueIndex("ai_knowledge_entries_user_source_uq").on(t.userId, t.sourceKey),
  pending: index("ai_knowledge_entries_status_idx").on(t.status, t.id),
}));
