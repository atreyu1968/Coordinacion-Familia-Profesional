import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

// Videoconference meeting rooms (Jitsi). Created only by coordinators or the
// superadmin; any authenticated user can see the list and join. The roomName is
// an unguessable slug used to build the public meet.jit.si URL.
export const meetingsTable = pgTable("meetings", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  roomName: text("room_name").notNull().unique(),
  hostId: integer("host_id").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Meeting = typeof meetingsTable.$inferSelect;
export type InsertMeeting = typeof meetingsTable.$inferInsert;
