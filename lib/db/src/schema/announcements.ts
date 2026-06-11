import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Bulletin-board announcements ("Tablón"). Visibility uses the shared audience
// model (`audienceType` + `audienceIds`), the same targeting used by meetings,
// forms and surveys: e.g. "all", a province/island/center, a module's members,
// specific users, or a role. `moduleId` is a convenience mirror when the
// audience is a single module (powers the display label). `provinceId` is a
// legacy column kept for backward compatibility (no longer written). Created by
// superadmin or provincial coordinators. Soft-deleted via `deletedAt`.
export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: integer("author_id"),
  // Legacy scoping column. Retained for backward compatibility; superseded by
  // the audience model below.
  provinceId: integer("province_id"),
  moduleId: integer("module_id"),
  audienceType: text("audience_type").notNull().default("all"),
  audienceIds: jsonb("audience_ids").$type<number[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Announcement = typeof announcementsTable.$inferSelect;
export type InsertAnnouncement = typeof announcementsTable.$inferInsert;

// Downloadable documents attached to an announcement. The actual bytes live in
// object storage; we keep the (caller-bound, private) objectPath plus display
// metadata. Multiple attachments per announcement.
export const announcementAttachmentsTable = pgTable("announcement_attachments", {
  id: serial("id").primaryKey(),
  announcementId: integer("announcement_id").notNull(),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AnnouncementAttachment =
  typeof announcementAttachmentsTable.$inferSelect;
export type InsertAnnouncementAttachment =
  typeof announcementAttachmentsTable.$inferInsert;
