import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const chatGroupsTable = pgTable("chat_groups", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("group"),
  provinceId: integer("province_id"),
  centerId: integer("center_id"),
  createdById: integer("created_by_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ChatGroup = typeof chatGroupsTable.$inferSelect;
export type InsertChatGroup = typeof chatGroupsTable.$inferInsert;
