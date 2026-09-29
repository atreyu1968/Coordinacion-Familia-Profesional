import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Legacy mapping retained for existing Outline installations. The native wiki
// does not read or write this table, and it is intentionally kept to preserve
// the old collection/group references without deleting external data.
export const wikiModuleCollectionsTable = pgTable(
  "wiki_module_collections",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull(),
    collectionId: text("collection_id").notNull(),
    editorGroupId: text("editor_group_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => ({
    uniqModule: unique().on(t.moduleId),
  }),
);

export type WikiModuleCollection =
  typeof wikiModuleCollectionsTable.$inferSelect;
export type InsertWikiModuleCollection =
  typeof wikiModuleCollectionsTable.$inferInsert;
