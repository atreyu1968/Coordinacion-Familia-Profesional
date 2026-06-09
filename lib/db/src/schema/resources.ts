import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const resourcesTable = pgTable("resources", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  fileUrl: text("file_url"),
  authorId: integer("author_id"),
  originalAuthorName: text("original_author_name"),
  moduleId: integer("module_id"),
  centerId: integer("center_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Resource = typeof resourcesTable.$inferSelect;
export type InsertResource = typeof resourcesTable.$inferInsert;
