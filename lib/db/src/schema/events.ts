import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  date,
  unique,
} from "drizzle-orm/pg-core";

// A professional event: the "Canarias Skills" olympiad, a provincial session
// (jornada) or other. Province-scoped (null = global/regional).
export const eventsTable = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // canarias_skills | jornada | other
  description: text("description"),
  location: text("location"),
  provinceId: integer("province_id"),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  status: text("status").notNull().default("planned"), // planned | active | done
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

// An accreditation (pass) for a participant, jury member, authority or staff.
// `qrToken` is an opaque random string encoded into the QR; the mobile scanner
// submits it back to the check-in endpoint. Unique so a token maps to one pass.
export const eventAccreditationsTable = pgTable("event_accreditations", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  holderName: text("holder_name").notNull(),
  holderEmail: text("holder_email"),
  role: text("role").notNull(), // participant | jury | authority | staff
  qrToken: text("qr_token").notNull().unique(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Staff / volunteering assignment: a platform user assigned a task/role/shift.
export const eventStaffTable = pgTable("event_staff", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  userId: integer("user_id").notNull(),
  task: text("task"),
  role: text("role"),
  shiftStart: timestamp("shift_start", { withTimezone: true }),
  shiftEnd: timestamp("shift_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// A physical space (pabellón / aula) with capacity and material resources.
export const eventSpacesTable = pgTable("event_spaces", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  capacity: integer("capacity"),
  resources: text("resources").array(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Attendance confirmation (RSVP) for a provincial session. One row per user per
// event; re-submitting updates the status. Drives certificate issuance.
export const eventRsvpsTable = pgTable(
  "event_rsvps",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    userId: integer("user_id").notNull(),
    status: text("status").notNull(), // yes | no | maybe
    certificateIssuedAt: timestamp("certificate_issued_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserPerEvent: unique().on(t.eventId, t.userId),
  }),
);

// Unified provincial calendar entry: milestones (FCT windows, programming
// deadlines), events and custom markers. Province-scoped (null = global).
export const calendarEntriesTable = pgTable("calendar_entries", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type"), // event | fct | deadline | milestone | other
  date: date("date").notNull(),
  endDate: date("end_date"),
  provinceId: integer("province_id"),
  description: text("description"),
  eventId: integer("event_id"),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Event = typeof eventsTable.$inferSelect;
export type InsertEvent = typeof eventsTable.$inferInsert;
export type EventAccreditation = typeof eventAccreditationsTable.$inferSelect;
export type EventStaff = typeof eventStaffTable.$inferSelect;
export type EventSpace = typeof eventSpacesTable.$inferSelect;
export type EventRsvp = typeof eventRsvpsTable.$inferSelect;
export type CalendarEntry = typeof calendarEntriesTable.$inferSelect;
