import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { wikiPagesTable } from "./wikiPages";

export const wikiExternalLinksTable = pgTable(
  "wiki_external_links",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => wikiPagesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    createdBy: integer("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    checkStatus: text("check_status").notNull().default("unchecked"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
    httpStatus: integer("http_status"),
    redirectUrl: text("redirect_url"),
    missingCount: integer("missing_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
  },
  (table) => ({
    pageIndex: index("wiki_external_links_page_id_idx").on(table.pageId),
    searchIndex: index("wiki_external_links_search_gin_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${table.title}, '') || ' ' || coalesce(${table.url}, ''))`,
    ),
  }),
);

export const insertWikiExternalLinkSchema = createInsertSchema(
  wikiExternalLinksTable,
).omit({
  id: true,
  createdAt: true,
  deletedAt: true,
});

export type WikiExternalLink = typeof wikiExternalLinksTable.$inferSelect;
export type InsertWikiExternalLink = typeof wikiExternalLinksTable.$inferInsert;