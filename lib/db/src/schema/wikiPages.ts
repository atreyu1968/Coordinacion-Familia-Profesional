import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

export const wikiPagesTable = pgTable(
  "wiki_pages",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id"),
    parentId: integer("parent_id"),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    tags: text("tags").array().notNull().default([]),
    createdBy: integer("created_by").notNull(),
    updatedBy: integer("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    moduleIndex: index("wiki_pages_module_id_idx").on(table.moduleId),
    parentIndex: index("wiki_pages_parent_id_idx").on(table.parentId),
    searchIndex: index("wiki_pages_search_gin_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${table.title}, '') || ' ' || coalesce(${table.content}, ''))`,
    ),
    tagsIndex: index("wiki_pages_tags_gin_idx").using("gin", table.tags),
    uniqueParentTitle: uniqueIndex("wiki_pages_parent_title_live_unique")
      .on(
        sql`coalesce(${table.moduleId}, 0)`,
        sql`coalesce(${table.parentId}, 0)`,
        table.title,
      )
      .where(sql`${table.deletedAt} IS NULL`),
  }),
);

export const wikiAttachmentsTable = pgTable(
  "wiki_attachments",
  {
    id: serial("id").primaryKey(),
    pageId: integer("page_id")
      .notNull()
      .references(() => wikiPagesTable.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    objectPath: text("object_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    indexedText: text("indexed_text").notNull().default(""),
    indexStatus: text("index_status").notNull().default("pending"),
    uploadedBy: integer("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    pageIndex: index("wiki_attachments_page_id_idx").on(table.pageId),
    searchIndex: index("wiki_attachments_search_gin_idx").using(
      "gin",
      sql`to_tsvector('simple', coalesce(${table.fileName}, '') || ' ' || coalesce(${table.indexedText}, ''))`,
    ),
  }),
);

export const wikiUploadIntentsTable = pgTable(
  "wiki_upload_intents",
  {
    id: serial("id").primaryKey(),
    objectPath: text("object_path").notNull().unique(),
    pageId: integer("page_id"),
    userId: integer("user_id").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => ({
    userExpiryIndex: index("wiki_upload_intents_user_expiry_idx").on(
      table.userId,
      table.expiresAt,
    ),
  }),
);

export const insertWikiPageSchema = createInsertSchema(wikiPagesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
});

export type WikiPage = typeof wikiPagesTable.$inferSelect;
export type InsertWikiPage = typeof wikiPagesTable.$inferInsert;
export type WikiAttachment = typeof wikiAttachmentsTable.$inferSelect;
export type InsertWikiAttachment = typeof wikiAttachmentsTable.$inferInsert;