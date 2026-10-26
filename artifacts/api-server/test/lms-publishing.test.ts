import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  announcementsTable,
  db,
  lmsCoursesTable,
  lmsLessonsTable,
  lmsCertificatesTable,
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
    await db.delete(lmsCertificatesTable).where(eq(lmsCertificatesTable.courseId, courseId));
    await db.delete(lmsLessonsTable).where(eq(lmsLessonsTable.courseId, courseId));
    await db.delete(lmsCoursesTable).where(eq(lmsCoursesTable.id, courseId));
  }
  await db.delete(notificationsTable).where(eq(notificationsTable.title, `Nuevo curso: ${testMarker}`));
  await cleanup();
});

describe("LMS course publication notices", () => {
  it("keeps the retired course download unavailable without issuing or deleting historical records", async () => {
    const owner = await createUser("coordinator");
    const [course] = await db.insert(lmsCoursesTable).values({
      title: `${testMarker}-legacy`, description: "", status: "published",
      certificateEnabled: true, createdBy: owner.user.id,
    }).returning();
    const [lesson] = await db.insert(lmsLessonsTable).values({
      courseId: course.id, title: "Lectura", kind: "text", required: true,
    }).returning();
    try {
      const detail = await request(app).get(`/api/lms/courses/${course.id}`).set(authHeader(owner.token));
      expect(detail.status).toBe(200);
      expect(detail.body.certificateEnabled).toBe(false);
      expect(detail.body.certificateAvailable).toBe(false);
      const completed = await request(app).post(`/api/lms/lessons/${lesson.id}/complete`).set(authHeader(owner.token));
      expect(completed.status).toBe(200);
      expect(await db.select().from(lmsCertificatesTable).where(eq(lmsCertificatesTable.courseId, course.id))).toHaveLength(0);
      await db.insert(lmsCertificatesTable).values({
        courseId: course.id, userId: owner.user.id, certificateNumber: `${testMarker}-historical`,
      });
      const download = await request(app).get(`/api/lms/courses/${course.id}/certificate`).set(authHeader(owner.token));
      expect(download.status).toBe(404);
      expect(await db.select().from(lmsCertificatesTable).where(eq(lmsCertificatesTable.courseId, course.id))).toHaveLength(1);
    } finally {
      await db.delete(lmsCertificatesTable).where(eq(lmsCertificatesTable.courseId, course.id));
      await db.delete(lmsLessonsTable).where(eq(lmsLessonsTable.courseId, course.id));
      await db.delete(lmsCoursesTable).where(eq(lmsCoursesTable.id, course.id));
    }
  });
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
