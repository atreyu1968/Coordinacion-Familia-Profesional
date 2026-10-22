import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const certificateEmailVerificationsTable = pgTable("certificate_email_verifications", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  codeHash: text("code_hash"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});
