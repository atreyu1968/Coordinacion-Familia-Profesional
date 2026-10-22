import { pgTable, serial, integer, text, timestamp, unique } from "drizzle-orm/pg-core";
import { eventsTable } from "./events";
import { usersTable } from "./users";

export const eventAttendancesTable = pgTable("event_attendances", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  source: text("source").notNull().default("app"),
  status: text("status").notNull().default("pending"),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  confirmedBy: integer("confirmed_by").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [unique().on(t.eventId, t.email)]);
