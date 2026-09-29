import {
  integer,
  pgTable,
  serial,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Group membership grants its action set only within the selected module wiki.
// A group can be reused by assigning it to users in multiple modules.
export const wikiModulePermissionGroupMembersTable = pgTable(
  "wiki_module_permission_group_members",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull(),
    groupId: integer("group_id").notNull(),
    userId: integer("user_id").notNull(),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueGroupMemberPerModule: unique().on(
      t.moduleId,
      t.groupId,
      t.userId,
    ),
  }),
);

export type WikiModulePermissionGroupMember =
  typeof wikiModulePermissionGroupMembersTable.$inferSelect;
export type InsertWikiModulePermissionGroupMember =
  typeof wikiModulePermissionGroupMembersTable.$inferInsert;