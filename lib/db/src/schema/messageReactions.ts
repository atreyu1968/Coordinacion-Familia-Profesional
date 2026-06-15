import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const messageReactionsTable = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull(),
    userId: integer("user_id").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueReaction: unique("message_reactions_message_user_emoji_unique").on(
      t.messageId,
      t.userId,
      t.emoji,
    ),
  }),
);

export type MessageReaction = typeof messageReactionsTable.$inferSelect;
export type InsertMessageReaction = typeof messageReactionsTable.$inferInsert;
