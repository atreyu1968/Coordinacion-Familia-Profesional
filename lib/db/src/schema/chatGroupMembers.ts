import {
  pgTable,
  serial,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const chatGroupMembersTable = pgTable(
  "chat_group_members",
  {
    id: serial("id").primaryKey(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueMember: unique("chat_group_members_group_user_unique").on(
      t.groupId,
      t.userId,
    ),
  }),
);

export type ChatGroupMember = typeof chatGroupMembersTable.$inferSelect;
export type InsertChatGroupMember = typeof chatGroupMembersTable.$inferInsert;
