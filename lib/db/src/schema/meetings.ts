import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Videoconference meeting rooms (Jitsi / 8x8 JaaS). A meeting belongs to a
// module (`moduleId`): it is visible to and joinable by that module's members
// (plus superadmin / coordinators in scope). Created by superadmin, coordinators
// or the module's coordinator. Legacy rooms created before this change have a
// null `moduleId` and are only visible to superadmin / coordinators. The
// roomName is an unguessable slug used to build the join URL.
export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  roomName: text("room_name").notNull().unique(),
  hostId: integer("host_id").notNull(),
  moduleId: integer("module_id"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Meeting = typeof meetingsTable.$inferSelect;
export type InsertMeeting = typeof meetingsTable.$inferInsert;
