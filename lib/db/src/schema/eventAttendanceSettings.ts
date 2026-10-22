import { pgTable, integer, text, boolean, date } from "drizzle-orm/pg-core";
import { eventsTable } from "./events";

export const eventAttendanceSettingsTable = pgTable("event_attendance_settings", {
  eventId: integer("event_id").primaryKey().references(() => eventsTable.id, { onDelete: "cascade" }),
  signerName: text("signer_name").notNull(),
  signerRole: text("signer_role").notNull(),
  issuePlace: text("issue_place").notNull().default("Canarias"),
  issueDate: date("issue_date", { mode: "string" }),
  modality: text("modality").notNull().default("presencial"),
  durationMinutes: integer("duration_minutes"),
  additionalText: text("additional_text").notNull().default(""),
  registrationOpen: boolean("registration_open").notNull().default(false),
  registrationToken: text("registration_token").notNull().unique(),
});
