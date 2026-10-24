import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db, lmsCoursesTable, lmsLessonsTable, lmsLessonProgressTable, lmsCoursePositionsTable,
} from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createUser, type SeededUser } from "./helpers";

let learner: SeededUser;
let other: SeededUser;
let owner: SeededUser;
const courses: number[] = [];
let lessons: number[] = [];
let foreignLesson: number;
let draft: number;
const position = (id: number) => `/api/lms/courses/${id}/position`;
const detail = (id: number) => `/api/lms/courses/${id}`;

beforeAll(async () => {
  learner = await createUser();
  other = await createUser();
  owner = await createUser({ role: "superadmin" });
  for (const status of ["published", "published", "draft"]) {
    const [course] = await db.insert(lmsCoursesTable).values({
      title: `Position regression ${learner.email}`, status, createdBy: owner.user.id,
    }).returning();
    courses.push(course!.id);
  }
  draft = courses[2]!;
  const rows = await db.insert(lmsLessonsTable).values([0, 1, 2].map((position) => ({
    courseId: courses[0]!, title: `Lesson ${position}`, kind: "text", position,
  }))).returning();
  lessons = rows.map((row) => row.id);
  const [foreign] = await db.insert(lmsLessonsTable).values({
    courseId: courses[1]!, title: "Other course", kind: "text",
  }).returning();
  foreignLesson = foreign!.id;
});
afterAll(async () => {
  if (courses.length) {
    await db.delete(lmsCoursePositionsTable).where(inArray(lmsCoursePositionsTable.courseId, courses));
    await db.delete(lmsLessonProgressTable).where(inArray(lmsLessonProgressTable.courseId, courses));
    await db.delete(lmsLessonsTable).where(inArray(lmsLessonsTable.courseId, courses));
    await db.delete(lmsCoursesTable).where(inArray(lmsCoursesTable.id, courses));
  }
  await cleanup();
});

describe("user-scoped LMS reading position", () => {
  it("requires authentication, a published visible course and a live lesson from that course", async () => {
    const data = { lessonId: lessons[0] };
    await request(app).put(position(courses[0]!)).send(data).expect(401);
    await request(app).put(position(draft)).set(authHeader(learner.token)).send(data).expect(404);
    await request(app).put(position(draft)).set(authHeader(owner.token)).send(data).expect(403);
    await request(app).put(position(courses[0]!)).set(authHeader(learner.token))
      .send({ lessonId: foreignLesson }).expect(404);
    for (const invalid of [{ lessonId: -1 }, { lessonId: "1" }, {}, { ...data, userId: other.user.id }]) {
      await request(app).put(position(courses[0]!)).set(authHeader(learner.token)).send(invalid).expect(400);
    }
    await request(app).put(position(courses[0]!)).query({ preview: true })
      .set(authHeader(owner.token)).send(data).expect(403);
    await db.update(lmsLessonsTable).set({ deletedAt: new Date() }).where(eq(lmsLessonsTable.id, lessons[2]!));
    await request(app).put(position(courses[0]!)).set(authHeader(learner.token))
      .send({ lessonId: lessons[2] }).expect(404);
    await db.update(lmsLessonsTable).set({ deletedAt: null }).where(eq(lmsLessonsTable.id, lessons[2]!));
  });

  it("shares web → mobile → web position without touching progress, attempts or certificates", async () => {
    const web = request.agent(app);
    const mobile = request.agent(app);
    const courseId = courses[0]!;
    expect((await web.get(detail(courseId)).set(authHeader(learner.token))).body.lastOpenedLessonId).toBeNull();
    await web.put(position(courseId)).set(authHeader(learner.token)).send({ lessonId: lessons[1] }).expect(204);
    const resumedMobile = await mobile.get(detail(courseId)).set(authHeader(learner.token)).expect(200);
    expect(resumedMobile.body.lastOpenedLessonId).toBe(lessons[1]);
    expect(resumedMobile.body.progress).toEqual([]);
    expect(resumedMobile.body.completed).toBe(false);
    expect(resumedMobile.body.certificateAvailable).toBe(false);
    await mobile.put(position(courseId)).set(authHeader(learner.token)).send({ lessonId: lessons[2] }).expect(204);
    expect((await web.get(detail(courseId)).set(authHeader(learner.token))).body.lastOpenedLessonId).toBe(lessons[2]);
    expect((await web.get(detail(courseId)).set(authHeader(other.token))).body.lastOpenedLessonId).toBeNull();
    expect((await web.get(detail(courses[1]!)).set(authHeader(learner.token))).body.lastOpenedLessonId).toBeNull();
    await mobile.put(position(courseId)).set(authHeader(other.token)).send({ lessonId: lessons[0] }).expect(204);
    expect((await web.get(detail(courseId)).set(authHeader(learner.token))).body.lastOpenedLessonId).toBe(lessons[2]);
    expect(await db.select().from(lmsLessonProgressTable).where(eq(lmsLessonProgressTable.courseId, courseId))).toEqual([]);
  });

  it("retains completion when reopening a completed lesson; never substitutes completion for position", async () => {
    const courseId = courses[0]!;
    await request(app).post(`/api/lms/lessons/${lessons[0]}/complete`).set(authHeader(learner.token)).expect(200);
    const [before] = await db.select().from(lmsLessonProgressTable).where(eq(lmsLessonProgressTable.courseId, courseId));
    await request(app).put(position(courseId)).set(authHeader(learner.token)).send({ lessonId: lessons[0] }).expect(204);
    const result = await request(app).get(detail(courseId)).set(authHeader(learner.token)).expect(200);
    expect(result.body.lastOpenedLessonId).toBe(lessons[0]);
    expect(result.body.progress[0].status).toBe("completed");
    const [after] = await db.select().from(lmsLessonProgressTable).where(eq(lmsLessonProgressTable.courseId, courseId));
    expect(after).toEqual(before);
  });

  it("returns no resume target after soft or hard deletion, so clients choose the first pending lesson", async () => {
    const courseId = courses[0]!;
    await db.update(lmsLessonsTable).set({ deletedAt: new Date() }).where(eq(lmsLessonsTable.id, lessons[0]!));
    expect((await request(app).get(detail(courseId)).set(authHeader(learner.token))).body.lastOpenedLessonId).toBeNull();
    await request(app).put(position(courseId)).set(authHeader(learner.token)).send({ lessonId: lessons[2] }).expect(204);
    await db.delete(lmsLessonsTable).where(eq(lmsLessonsTable.id, lessons[2]!));
    expect((await request(app).get(detail(courseId)).set(authHeader(learner.token))).body.lastOpenedLessonId).toBeNull();
    await db.update(lmsCoursesTable).set({ deletedAt: new Date() }).where(eq(lmsCoursesTable.id, courseId));
    await request(app).put(position(courseId)).set(authHeader(learner.token)).send({ lessonId: lessons[1] }).expect(404);
    await request(app).get(detail(courseId)).set(authHeader(learner.token)).expect(404);
  });
});
