import {
  pgTable,
  serial,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Explicit edit grants for module pages. All authenticated users can read;
// module coordinators and superadmins manage these grants, and only users with
// an active row can edit. General pages remain superadmin-only.
// Removing access soft-deletes the row; re-granting reuses the (module_id,
// user_id) slot, so updates must upsert.
//
// Grants are made by a superadmin (to anyone) or by the module's coordinator
// (to that module's collaborating teachers) — enforced in the route layer.
export const wikiModuleEditorsTable = pgTable(
  "wiki_module_editors",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull(),
    userId: integer("user_id").notNull(),
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
