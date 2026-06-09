import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// In-app feedback submitted by any authenticated user: improvement suggestions
// or application incidents (bugs). Not province/center scoped — these are
// platform-level reports handled by the superadmin.
export const appFeedbackTable = pgTable("app_feedback", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  type: text("type").notNull(), // suggestion | incident
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull().default("open"), // open | reviewed | resolved
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type AppFeedback = typeof appFeedbackTable.$inferSelect;
export type InsertAppFeedback = typeof appFeedbackTable.$inferInsert;
