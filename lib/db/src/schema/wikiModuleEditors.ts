import {
  pgTable,
  serial,
  integer,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Direct per-action permissions for a user's module wiki access. Existing rows
// default to all permissions so adding granular controls preserves current access.
export const wikiModuleEditorsTable = pgTable(
  "wiki_module_editors",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull(),
    userId: integer("user_id").notNull(),
    canUpload: boolean("can_upload").notNull().default(true),
    canEdit: boolean("can_edit").notNull().default(true),
    canDelete: boolean("can_delete").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    uniqUserPerModule: unique().on(t.moduleId, t.userId),
  }),
);

export type WikiModuleEditor = typeof wikiModuleEditorsTable.$inferSelect;
export type InsertWikiModuleEditor =
  typeof wikiModuleEditorsTable.$inferInsert;
