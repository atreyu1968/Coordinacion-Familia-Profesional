import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Reusable permission profiles. Groups are shared across module wikis; their
// members are assigned separately within each module.
export const wikiPermissionGroupsTable = pgTable(
  "wiki_permission_groups",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    canUpload: boolean("can_upload").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueActiveGroupName: uniqueIndex("wiki_permission_groups_active_name_uidx")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  }),
);

export type WikiPermissionGroup =
  typeof wikiPermissionGroupsTable.$inferSelect;
export type InsertWikiPermissionGroup =
  typeof wikiPermissionGroupsTable.$inferInsert;