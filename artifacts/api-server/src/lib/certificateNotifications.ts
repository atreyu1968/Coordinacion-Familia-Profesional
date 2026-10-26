import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, eventAttendancesTable, usersTable } from "@workspace/db";
import { notifyUsers } from "./notify";

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

/** Notify only active accounts tied to the attendance row or its exact email. */
export async function notifyCertificateRecipients(
  attendanceIds: number[],
  eventName: string,
) {
  const ids = Array.from(new Set(attendanceIds));
  if (!ids.length) return 0;

  const attendances = await db
    .select({
      userId: eventAttendancesTable.userId,
      email: eventAttendancesTable.email,
      eventId: eventAttendancesTable.eventId,
    })
    .from(eventAttendancesTable)
    .where(inArray(eventAttendancesTable.id, ids));
  const linkedUserIds = Array.from(
    new Set(attendances.flatMap((attendance) => attendance.userId == null ? [] : [attendance.userId])),
  );
  const unlinkedEmails = Array.from(
    new Set(attendances.flatMap((attendance) =>
      attendance.userId == null ? [normalizedEmail(attendance.email)] : [],
    )),
  );

  const linkedUsers = linkedUserIds.length
    ? await db.select({ id: usersTable.id, email: usersTable.email })
      .from(usersTable)
      .where(and(
        inArray(usersTable.id, linkedUserIds),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ))
    : [];
  const usersByEmail = unlinkedEmails.length
    ? await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        inArray(usersTable.email, unlinkedEmails),
        eq(usersTable.status, "active"),
        isNull(usersTable.deletedAt),
      ))
    : [];

  const linkedIds = new Set(linkedUsers.map((user) => user.id));
  for (const attendance of attendances) {
    if (attendance.userId == null || !linkedIds.has(attendance.userId)) continue;
    const user = linkedUsers.find((candidate) => candidate.id === attendance.userId);
    if (!user || normalizedEmail(user.email) !== normalizedEmail(attendance.email)) {
      linkedIds.delete(attendance.userId);
    }
  }

  return notifyUsers([...new Set([...linkedIds, ...usersByEmail.map((user) => user.id)])], {
    title: "Certificado de asistencia disponible",
    body: `Ya puedes consultar tu certificado de asistencia a «${eventName}» en Mis certificados.`,
    type: "certificate",
    data: { eventId: attendances[0]?.eventId },
  });
}
