import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// Videoconference meeting rooms (Jitsi / 8x8 JaaS). Visibility is driven by the
// shared audience model (`audienceType` + `audienceIds`), the same targeting
// used by forms and surveys: e.g. "all", a province/island/center, a module's
// members, specific users, or a role (department heads / coordinators).
// `moduleId` is kept as a convenience mirror when the audience is a single
// module (powers module-coordinator moderator rights + display). Created by
// superadmin, provincial coordinators, or a module coordinator (for their
// module). The roomName is an unguessable slug used to build the join URL.
export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  roomName: text("room_name").notNull().unique(),
  hostId: integer("host_id").notNull(),
  moduleId: integer("module_id"),
  audienceType: text("audience_type").notNull().default("all"),
  audienceIds: jsonb("audience_ids")
    .$type<number[]>()
    .notNull()
    .default([]),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Meeting = typeof meetingsTable.$inferSelect;
export type InsertMeeting = typeof meetingsTable.$inferInsert;
