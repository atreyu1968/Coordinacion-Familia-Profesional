import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  announcementsTable,
  db,
  lmsCoursesTable,
  lmsLessonsTable,
  notificationsTable,
} from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createUser } from "./helpers";

const testMarker = `publicacion-lms-${Date.now()}`;
let courseId: number | undefined;
let announcementId: number | undefined;

afterAll(async () => {
  if (announcementId != null) {
    await db.delete(announcementsTable).where(eq(announcementsTable.id, announcementId));
  }
  if (courseId != null) {
    await db.delete(lmsLessonsTable).where(eq(lmsLessonsTable.courseId, courseId));
    await db.delete(lmsCoursesTable).where(eq(lmsCoursesTable.id, courseId));
  }
  await db.delete(notificationsTable).where(eq(notificationsTable.title, `Nuevo curso: ${testMarker}`));
  await cleanup();
});

describe("LMS course publication notices", () => {
  it("creates one Tablón announcement and notifies active users only once", async () => {
    const publisher = await createUser({ role: "superadmin" });
    const recipient = await createUser();
    const inactiveRecipient = await createUser({ status: "inactive" });
    const [course] = await db.insert(lmsCoursesTable).values({
      title: testMarker,
      description: "Contenido de prueba.",
      createdBy: publisher.user.id,
    }).returning();
    expect(course).toBeDefined();
    if (!course) return;
    courseId = course.id;

    await db.insert(lmsLessonsTable).values({
      courseId: course.id,
      title: "Lección de prueba",
      kind: "text",
    });

    const publish = () => request(app)
      .post(`/api/lms/courses/${course.id}/publish`)
      .set(authHeader(publisher.token));
    const first = await publish();
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("published");

    const announcementTitle = `Nuevo curso autodirigido: ${testMarker}`;
    const announcements = await db.select().from(announcementsTable)
      .where(eq(announcementsTable.title, announcementTitle));
    expect(announcements).toHaveLength(1);
    announcementId = announcements[0]!.id;
    expect(announcements[0]).toMatchObject({
      authorId: publisher.user.id,
      audienceType: "all",
      audienceIds: [],
    });

    const notificationTitle = `Nuevo curso: ${testMarker}`;
    const recipientNotifications = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, recipient.user.id),
        eq(notificationsTable.title, notificationTitle),
      ));
    expect(recipientNotifications).toHaveLength(1);
    expect(recipientNotifications[0]!.type).toBe("lms_course");

    const publisherNotifications = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, publisher.user.id),
        eq(notificationsTable.title, notificationTitle),
      ));
    expect(publisherNotifications).toHaveLength(0);

    const inactiveNotifications = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, inactiveRecipient.user.id),
        eq(notificationsTable.title, notificationTitle),
      ));
    expect(inactiveNotifications).toHaveLength(0);

    const second = await publish();
    expect(second.status).toBe(200);
    const duplicateAnnouncements = await db.select().from(announcementsTable)
      .where(eq(announcementsTable.title, announcementTitle));
    expect(duplicateAnnouncements).toHaveLength(1);
    const duplicateNotifications = await db.select().from(notificationsTable)
      .where(and(
        eq(notificationsTable.userId, recipient.user.id),
        eq(notificationsTable.title, notificationTitle),
      ));
    expect(duplicateNotifications).toHaveLength(1);
  });
});
