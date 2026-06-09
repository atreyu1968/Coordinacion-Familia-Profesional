import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Discussion forums organized by training cycle/module. One board per module
// (modules carry cycleName + centerId, so threads are grouped by cycle in the
// UI). A thread's centerId is denormalized from its module for scope filtering;
// null means the module is global (visible to everyone). The opening message of
// a thread is stored as its first forum_posts row.
export const forumThreadsTable = pgTable("forum_threads", {
  id: serial("id").primaryKey(),
  moduleId: integer("module_id").notNull(),
  centerId: integer("center_id"),
  title: text("title").notNull(),
  authorId: integer("author_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastPostAt: timestamp("last_post_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const forumPostsTable = pgTable("forum_posts", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull(),
  authorId: integer("author_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type ForumThread = typeof forumThreadsTable.$inferSelect;
export type InsertForumThread = typeof forumThreadsTable.$inferInsert;
export type ForumPost = typeof forumPostsTable.$inferSelect;
export type InsertForumPost = typeof forumPostsTable.$inferInsert;
