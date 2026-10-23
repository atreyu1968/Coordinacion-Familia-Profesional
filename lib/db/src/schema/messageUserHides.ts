import {
  integer,
  pgTable,
  serial,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { messagesTable } from "./messages";
import { usersTable } from "./users";

export const messageUserHidesTable = pgTable(
  "message_user_hides",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id")
      .notNull()
      .references(() => messagesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqueUserMessage: unique("message_user_hides_user_message_unique").on(
      table.userId,
      table.messageId,
    ),
  }),
);

export type MessageUserHide = typeof messageUserHidesTable.$inferSelect;
export type InsertMessageUserHide = typeof messageUserHidesTable.$inferInsert;
