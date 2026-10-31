import { pgTable, serial, integer, text, timestamp, uniqueIndex, index, primaryKey } from "drizzle-orm/pg-core";
import { modulesTable } from "./modules";
import { forumThreadsTable } from "./forums";
import { usersTable } from "./users";
import { notificationsTable } from "./notifications";

export const forumDigestEventsTable = pgTable("forum_digest_events", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  threadId: integer("thread_id").notNull().references(() => forumThreadsTable.id, { onDelete: "cascade" }),
  actorId: integer("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  eventKey: text("event_key").notNull(),
  kind: text("kind").notNull(),
  bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("forum_digest_event_key_uq").on(t.moduleId, t.eventKey),
  index("forum_digest_pending_idx").on(t.processedAt, t.nextAttemptAt),
  index("forum_digest_bucket_idx").on(t.moduleId, t.bucketAt)]);

export const forumDigestDeliveriesTable = pgTable("forum_digest_deliveries", {
  moduleId: integer("module_id").notNull().references(() => modulesTable.id, { onDelete: "cascade" }),
  bucketAt: timestamp("bucket_at", { withTimezone: true }).notNull(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  notificationId: integer("notification_id").references(() => notificationsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.moduleId, t.bucketAt, t.userId] })]);
