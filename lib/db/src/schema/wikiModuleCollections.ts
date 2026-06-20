import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Mapping between an academic module and its Outline (wiki) resources. Outline
// identifies collections and groups by opaque UUIDs, so we cache them here to
// keep provisioning idempotent (we never re-create a collection/group that
// already exists for a module). One row per module.
//
// - collectionId: the Outline collection that holds the module's documents.
//   Its workspace-wide default permission is "read" (everyone reads).
// - editorGroupId: an Outline group granted "read_write" on the collection;
//   its membership is the set of users allowed to edit (see wiki_module_editors).
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
