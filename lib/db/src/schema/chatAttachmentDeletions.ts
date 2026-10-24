import {
  integer,
  index,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Only unresolved rows retain an object path. The path is cleared after a
// successful delete so completed jobs do not retain storage identifiers.
export const chatAttachmentDeletionsTable = pgTable(
  "chat_attachment_deletions",
  {
    id: serial("id").primaryKey(),
    objectPath: text("object_path"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseToken: text("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("chat_attachment_deletions_done_completed_at_idx")
      .on(table.completedAt)
      .where(sql`${table.status} = 'done'`),
  ],
);

export type ChatAttachmentDeletion =
  typeof chatAttachmentDeletionsTable.$inferSelect;
