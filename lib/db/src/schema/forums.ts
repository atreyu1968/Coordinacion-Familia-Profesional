import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";

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
  // Manager-set highlight: pinned threads sort to the top (null = not pinned).
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  // Set when the author edits the title (null = never edited).
  editedAt: timestamp("edited_at", { withTimezone: true }),
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
  // Set when the author edits the message (null = never edited).
  editedAt: timestamp("edited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// Per-user read marker for a thread: lastReadAt is bumped whenever the user
// opens the thread. Unread counts compare post createdAt against this value.
export const forumThreadReadsTable = pgTable(
  "forum_thread_reads",
  {
    userId: integer("user_id").notNull(),
    threadId: integer("thread_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.threadId] })],
);

export type ForumThread = typeof forumThreadsTable.$inferSelect;
export type InsertForumThread = typeof forumThreadsTable.$inferInsert;
export type ForumPost = typeof forumPostsTable.$inferSelect;
export type InsertForumPost = typeof forumPostsTable.$inferInsert;
export type ForumThreadRead = typeof forumThreadReadsTable.$inferSelect;
export type InsertForumThreadRead = typeof forumThreadReadsTable.$inferInsert;
