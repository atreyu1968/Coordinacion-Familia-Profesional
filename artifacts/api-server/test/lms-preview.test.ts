import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, lmsCoursesTable, lmsLessonsTable, lmsLessonProgressTable, lmsCourseManagersTable,
} from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createUser, type SeededUser } from "./helpers";

let owner: SeededUser;
let learner: SeededUser;
let courseId: number;
let lessonId: number;

beforeAll(async () => {
  owner = await createUser({ role: "superadmin" });
  learner = await createUser();
  const [course] = await db.insert(lmsCoursesTable).values({
    title: "Private SCORM preview regression", status: "draft", createdBy: owner.user.id,
  }).returning();
  courseId = course!.id;
  const [lesson] = await db.insert(lmsLessonsTable).values({
    courseId, title: "Preview SCORM", kind: "scorm12",
    objectPath: "private/test-preview-not-an-existing-object.zip",
    scormLaunchPath: "index.html", scormVersion: "1.2",
  }).returning();
  lessonId = lesson!.id;
});

afterAll(async () => {
  if (courseId) {
    await db.delete(lmsLessonProgressTable).where(eq(lmsLessonProgressTable.courseId, courseId));
    await db.delete(lmsLessonsTable).where(eq(lmsLessonsTable.courseId, courseId));
    await db.delete(lmsCoursesTable).where(eq(lmsCoursesTable.id, courseId));
  }
  await cleanup();
});

describe("manager-only SCORM preview", () => {
  it("creates no progress and rejects all commits, including direct requests", async () => {
    const session = await request(app)
      .post(`/api/lms/lessons/${lessonId}/scorm-session?preview=true`)
      .set(authHeader(owner.token)).expect(200);
    expect(session.body.cmiData).toEqual({});
    expect(await db.select().from(lmsLessonProgressTable)
      .where(eq(lmsLessonProgressTable.courseId, courseId))).toHaveLength(0);
    await request(app).post("/api/lms/scorm/commit").query({ token: session.body.token })
      .send({ cmiData: { "cmi.core.lesson_status": "completed" } }).expect(403);
    expect(await db.select().from(lmsLessonProgressTable)
      .where(eq(lmsLessonProgressTable.courseId, courseId))).toHaveLength(0);

    const [stored] = await db.insert(lmsLessonProgressTable).values({
      userId: owner.user.id, courseId, lessonId, status: "completed", attempts: 8,
      score: 95, cmiData: { resume: "keep-me" },
    }).returning();
    const again = await request(app)
      .post(`/api/lms/lessons/${lessonId}/scorm-session?preview=true`)
      .set(authHeader(owner.token)).expect(200);
    expect(again.body.cmiData).toEqual({});
    const [unchanged] = await db.select().from(lmsLessonProgressTable)
      .where(eq(lmsLessonProgressTable.id, stored!.id));
    expect(unchanged).toEqual(stored);
  });

  it("does not expose drafts or preview mode to learners", async () => {
    await request(app).post(`/api/lms/lessons/${lessonId}/scorm-session?preview=true`)
      .set(authHeader(learner.token)).expect(404);
    await db.update(lmsCoursesTable).set({ status: "published" }).where(eq(lmsCoursesTable.id, courseId));
    try {
      await request(app).post(`/api/lms/lessons/${lessonId}/scorm-session?preview=true`)
        .set(authHeader(learner.token)).expect(403);
      await request(app).post(`/api/lms/lessons/${lessonId}/scorm-session?preview=invalid`)
        .set(authHeader(owner.token)).expect(400);
    } finally {
      await db.update(lmsCoursesTable).set({ status: "draft" }).where(eq(lmsCoursesTable.id, courseId));
    }
  });

  it("rechecks delegated management rights when a preview token is reused", async () => {
    const [grant] = await db.insert(lmsCourseManagersTable).values({
      userId: learner.user.id, isGeneral: true, grantedBy: owner.user.id,
    }).returning();
    try {
      const session = await request(app)
        .post(`/api/lms/lessons/${lessonId}/scorm-session?preview=true`)
        .set(authHeader(learner.token)).expect(200);
      await request(app).get("/api/lms/scorm/session").query({ token: session.body.token }).expect(200);
      await db.delete(lmsCourseManagersTable).where(eq(lmsCourseManagersTable.id, grant!.id));
      await request(app).get("/api/lms/scorm/session").query({ token: session.body.token }).expect(404);
      await request(app).post("/api/lms/scorm/commit").query({ token: session.body.token })
        .send({ cmiData: {} }).expect(404);
    } finally {
      await db.delete(lmsCourseManagersTable).where(eq(lmsCourseManagersTable.id, grant!.id));
    }
  });

  it("keeps progress recording enabled for ordinary learner sessions", async () => {
    await db.update(lmsCoursesTable).set({ status: "published" }).where(eq(lmsCoursesTable.id, courseId));
    try {
      await request(app).post(`/api/lms/lessons/${lessonId}/scorm-session`)
        .set(authHeader(learner.token)).expect(200);
      const progress = await db.select().from(lmsLessonProgressTable)
        .where(eq(lmsLessonProgressTable.courseId, courseId));
      expect(progress.find((row) => row.userId === learner.user.id)).toMatchObject({
        status: "in_progress", attempts: 1,
      });
    } finally {
      await db.update(lmsCoursesTable).set({ status: "draft" }).where(eq(lmsCoursesTable.id, courseId));
    }
  });
});
