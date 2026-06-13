import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const chatGroupsTable = pgTable(
  "chat_groups",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    type: text("type").notNull().default("group"),
    provinceId: integer("province_id"),
    centerId: integer("center_id"),
    // When set, this is the auto-managed group for a teaching module. Postgres
    // treats NULLs as distinct, so the unique index still allows many manual
    // (module-less) groups while guaranteeing at most one group per module.
    moduleId: integer("module_id"),
    createdById: integer("created_by_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uniqModule: uniqueIndex("chat_groups_module_id_key").on(table.moduleId),
  }),
);

export type ChatGroup = typeof chatGroupsTable.$inferSelect;
export type InsertChatGroup = typeof chatGroupsTable.$inferInsert;
