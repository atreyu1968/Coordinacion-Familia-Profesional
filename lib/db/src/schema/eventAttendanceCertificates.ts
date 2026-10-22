import { sql } from "drizzle-orm";
import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { eventsTable } from "./events";
import { eventAttendancesTable } from "./eventAttendances";
import { usersTable } from "./users";

// Issuance snapshot: later edits to profiles/events/settings cannot change an
// already issued certificate. No PDF bytes or email addresses in this record.
export type AttendanceCertificateSnapshot = {
  attendeeName: string;
  eventName: string;
  startAt: string;
  endAt: string;
  location: string | null;
  modality: string;
  durationMinutes: number;
  signerName: string;
  signerRole: string;
  issuePlace: string;
  issueDate: string;
  additionalText: string;
  professionalFamily: string;
  appName: string;
  verificationUrl: string;
  code: string;
  issuedAt: string;
};

export const eventAttendanceCertificatesTable = pgTable("event_attendance_certificates", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull().references(() => eventsTable.id, { onDelete: "cascade" }),
  attendanceId: integer("attendance_id").notNull().references(() => eventAttendancesTable.id, { onDelete: "cascade" }),
  verificationToken: text("verification_token").notNull().unique(),
  snapshot: jsonb("snapshot").$type<AttendanceCertificateSnapshot>().notNull(),
  issuedBy: integer("issued_by").references(() => usersTable.id, { onDelete: "set null" }),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: integer("revoked_by").references(() => usersTable.id, { onDelete: "set null" }),
  revocationReason: text("revocation_reason"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("event_attendance_certificates_active_idx").on(t.attendanceId).where(sql`${t.revokedAt} IS NULL`),
]);
