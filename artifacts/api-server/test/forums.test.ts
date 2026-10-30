import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  centersTable,
  integrationSettingsTable,
  trainingOfferTable,
  modulesTable,
  moduleMembershipsTable,
  teachingAssignmentsTable,
  usersTable,
} from "@workspace/db";
import app from "../src/app";
import { verifyToken } from "../src/lib/auth";
import { getActiveAcademicYear } from "../src/lib/settings";
import {
  createUser,
  createProvince,
  createCenter,
  createModule as createBaseModule,
  createTeachingAssignment,
  cleanup,
  authHeader,
  trackThread,
} from "./helpers";

const familyCenterIds = new Map<string, Promise<number>>();

afterAll(async () => {
  await cleanup();
});

async function activeFamily(): Promise<string> {
  const [settings] = await db
    .select({ professionalFamily: integrationSettingsTable.professionalFamily })
    .from(integrationSettingsTable)
    .limit(1);
  return settings?.professionalFamily?.trim() || "Administración y Gestión";
}

async function centerForFamily(family: string): Promise<number> {
  let pendingCenter = familyCenterIds.get(family);
  if (!pendingCenter) {
    pendingCenter = (async () => {
      const provinceId = await createProvince("Foros");
      const centerId = await createCenter(provinceId);
      await db
        .update(centersTable)
        .set({ families: [family] })
        .where(eq(centersTable.id, centerId));
      return centerId;
    })();
    familyCenterIds.set(family, pendingCenter);
  }
  return pendingCenter;
}

// Give each test module a cycle offered by a center in the active family so
// forum tests exercise their intended ACL behavior instead of unrelated data.
async function createModule(opts: {
  centerId?: number | null;
  cycleName?: string | null;
  code?: string | null;
  name?: string;
  family?: string;
} = {}): Promise<number> {
  const family = opts.family ?? (await activeFamily());
  const cycleName = opts.cycleName ?? `Ciclo foro ${Date.now()}-${Math.random()}`;
  const moduleId = await createBaseModule({
    centerId: opts.centerId ?? null,
    cycleName,
    code: opts.code,
    name: opts.name,
  });
  const offerCenterId =
    opts.centerId == null ? await centerForFamily(family) : opts.centerId;

  if (opts.centerId != null) {
    await db
      .update(centersTable)
      .set({ families: [family] })
      .where(eq(centersTable.id, opts.centerId));
  }
  await db.insert(trainingOfferTable).values({
    centerId: offerCenterId,
    cycleName,
    schoolYear: null,
  });
  return moduleId;
}

async function assignTeacherToModule(
  teacher: { user: { id: number; centerId: number | null } },
  moduleId: number,
): Promise<void> {
  const schoolYear = await getActiveAcademicYear();
  if (!schoolYear) throw new Error("Forum tests require an active academic year");
  const [module] = await db
    .select({ centerId: modulesTable.centerId })
    .from(modulesTable)
    .where(eq(modulesTable.id, moduleId));
  const centerId = module?.centerId ?? teacher.user.centerId;
  if (centerId == null) throw new Error("Teaching assignment requires a center");
  const [existing] = await db
    .select({ id: teachingAssignmentsTable.id })
    .from(teachingAssignmentsTable)
    .where(and(
      eq(teachingAssignmentsTable.teacherId, teacher.user.id),
      eq(teachingAssignmentsTable.moduleId, moduleId),
      eq(teachingAssignmentsTable.schoolYear, schoolYear),
      isNull(teachingAssignmentsTable.deletedAt),
    ))
    .limit(1);
  if (!existing) {
    await createTeachingAssignment({
      teacherId: teacher.user.id,
      moduleId,
      centerId,
      schoolYear,
    });
  }
}

async function ensureTokenTeacherTeachesModule(
  token: string,
  moduleId: number,
): Promise<void> {
  const payload = verifyToken(token);
  if (!payload || payload.role !== "teacher") return;
  const [teacher] = await db
    .select({ id: usersTable.id, centerId: usersTable.centerId })
    .from(usersTable)
    .where(eq(usersTable.id, payload.sub));
  if (teacher) await assignTeacherToModule({ user: teacher }, moduleId);
}

// Open a thread via the API and track it for cleanup.
async function openThread(
  token: string,
  moduleId: number,
  title = "Tema de prueba",
  content = "Mensaje inicial",
) {
  // A successful teacher-authored fixture represents a teacher assigned to
  // that module; tests for denied access use direct requests instead.
  await ensureTokenTeacherTeachesModule(token, moduleId);
  const res = await request(app)
    .post("/api/forum/threads")
    .set(authHeader(token))
    .send({ moduleId, title, content });
  if (res.status === 201) trackThread(res.body.id);
  return res;
}

describe("forum thread creation", () => {
  it("creates a thread with its opening post in one step", async () => {
    const moduleId = await createModule({ centerId: null });
    const teacher = await createUser({ role: "teacher" });

    const res = await openThread(teacher.token, moduleId, "Dudas", "Hola");
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Dudas");
    expect(res.body.postCount).toBe(1);
    const detail = await request(app)
      .get(`/api/forum/threads/${res.body.id}`)
      .set(authHeader(teacher.token));
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ id: res.body.id, title: "Dudas", postCount: 1, moduleId });
    expect((await request(app).get("/api/forum/threads/2147483648").set(authHeader(teacher.token))).status).toBe(400);

    const posts = await request(app)
      .get(`/api/forum/threads/${res.body.id}/posts`)
      .set(authHeader(teacher.token));
    expect(posts.status).toBe(200);
    expect(posts.body).toHaveLength(1);
    expect(posts.body[0].content).toBe("Hola");
  });

  it("rejects an empty title", async () => {
    const moduleId = await createModule({ centerId: null });
    const teacher = await createUser({ role: "teacher" });
    const res = await request(app)
      .post("/api/forum/threads")
      .set(authHeader(teacher.token))
      .send({ moduleId, title: "", content: "x" });
    expect(res.status).toBe(400);
  });
});

describe("forum module scope", () => {
  it("lists and allows threads only for modules in the configured family", async () => {
    const family = await activeFamily();
    const allowedModuleId = await createModule();
    const otherFamilyModuleId = await createModule({
      family: `${family} (otra familia)`,
    });
    const teacher = await createUser({ role: "teacher" });

    const allowedThread = await openThread(
      teacher.token,
      allowedModuleId,
      "Módulo de la familia activa",
    );
    expect(allowedThread.status).toBe(201);

    const blockedThread = await openThread(
      teacher.token,
      otherFamilyModuleId,
      "Módulo de otra familia",
    );
    expect(blockedThread.status).toBe(403);

    const modules = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(teacher.token));
    expect(modules.status).toBe(200);
    expect(
      modules.body.some((module: { id: number }) => module.id === allowedModuleId),
    ).toBe(true);
    expect(
      modules.body.some(
        (module: { id: number }) => module.id === otherFamilyModuleId,
      ),
    ).toBe(false);

    const hiddenThreads = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId: otherFamilyModuleId })
      .set(authHeader(teacher.token));
    expect(hiddenThreads.status).toBe(403);
  });

  it("hides center-scoped modules from users in other provinces", async () => {
    const provinceA = await createProvince("A");
    const provinceB = await createProvince("B");
    const centerA = await createCenter(provinceA);
    const moduleId = await createModule({ centerId: centerA });

    const outsider = await createUser({
      role: "teacher",
      provinceId: provinceB,
    });
    const res = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(outsider.token));
    expect(res.status).toBe(403);
  });

  it("does not expose every module merely because a teacher shares its center", async () => {
    const province = await createProvince("Misma provincia");
    const centerId = await createCenter(province);
    const moduleId = await createModule({ centerId });
    const author = await createUser({ role: "teacher", centerId, provinceId: province });
    const colleague = await createUser({ role: "teacher", centerId, provinceId: province });
    await db.insert(moduleMembershipsTable).values({
      userId: colleague.user.id,
      moduleId,
      role: "member",
    });
    const thread = await openThread(author.token, moduleId);
    expect(thread.status).toBe(201);

    const denied = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(colleague.token));
    expect(denied.status).toBe(403);

    const modules = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(colleague.token));
    expect(modules.body.some((module: { id: number }) => module.id === moduleId)).toBe(false);

    const notifications = await request(app)
      .get("/api/notifications")
      .set(authHeader(colleague.token));
    expect(
      notifications.body.some((notification: { type?: string }) => notification.type === "forum_thread"),
    ).toBe(false);
  });

  it("limits ordinary users to modules they teach, including global modules", async () => {
    const moduleId = await createModule({ centerId: null });
    const someone = await createUser({ role: "teacher" });
    const denied = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(someone.token));
    expect(denied.status).toBe(403);

    const listBefore = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(someone.token));
    expect(listBefore.body.some((module: { id: number }) => module.id === moduleId)).toBe(false);

    await assignTeacherToModule(someone, moduleId);
    const allowed = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(someone.token));
    expect(allowed.status).toBe(200);

    const listAfter = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(someone.token));
    expect(listAfter.body.some((module: { id: number }) => module.id === moduleId)).toBe(true);
  });

  it("returns 404 listing threads for a non-existent module", async () => {
    const someone = await createUser({ role: "teacher" });
    const res = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId: 999999999 })
      .set(authHeader(someone.token));
    expect(res.status).toBe(404);
  });
});

describe("forum replies", () => {
  it("appends a reply and bumps the post count", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);
    const threadId = created.body.id;

    const replier = await createUser({ role: "teacher" });
    await assignTeacherToModule(replier, moduleId);
    const reply = await request(app)
      .post(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(replier.token))
      .send({ content: "Respuesta" });
    expect(reply.status).toBe(201);

    const posts = await request(app)
      .get(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(author.token));
    expect(posts.body).toHaveLength(2);
  });
});

describe("forum deletion permissions", () => {
  it("lets the author delete their own thread", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const del = await request(app)
      .delete(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(author.token));
    expect(del.status).toBe(204);
  });

  it("forbids an unrelated teacher from deleting another's thread", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const other = await createUser({ role: "teacher" });
    await assignTeacherToModule(other, moduleId);
    const del = await request(app)
      .delete(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(other.token));
    expect(del.status).toBe(403);
  });

  it("lets a superadmin delete any thread", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const admin = await createUser({ role: "superadmin" });
    const del = await request(app)
      .delete(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(admin.token));
    expect(del.status).toBe(204);
  });

  it("lets a coordinator delete a thread within their province", async () => {
    const province = await createProvince("P");
    const center = await createCenter(province);
    const moduleId = await createModule({ centerId: center });
    const author = await createUser({ role: "teacher", centerId: center, provinceId: province });
    const created = await openThread(author.token, moduleId);

    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const del = await request(app)
      .delete(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(coordinator.token));
    expect(del.status).toBe(204);
  });

  it("forbids a coordinator from deleting a thread in another province", async () => {
    const provinceA = await createProvince("A");
    const provinceB = await createProvince("B");
    const centerA = await createCenter(provinceA);
    const moduleId = await createModule({ centerId: centerA });
    const author = await createUser({ role: "teacher", centerId: centerA, provinceId: provinceA });
    const created = await openThread(author.token, moduleId);

    const coordinator = await createUser({ role: "coordinator", provinceId: provinceB });
    const del = await request(app)
      .delete(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(coordinator.token));
    expect(del.status).toBe(403);
  });

  it("forbids a coordinator from deleting a global thread (manager scope only)", async () => {
    const province = await createProvince("P");
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const del = await request(app)
      .delete(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(coordinator.token));
    expect(del.status).toBe(403);
  });

  it("forbids deleting another user's reply", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);
    const threadId = created.body.id;

    const replier = await createUser({ role: "teacher" });
    await assignTeacherToModule(replier, moduleId);
    const reply = await request(app)
      .post(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(replier.token))
      .send({ content: "Mía" });
    expect(reply.status).toBe(201);

    const other = await createUser({ role: "teacher" });
    const del = await request(app)
      .delete(`/api/forum/posts/${reply.body.id}`)
      .set(authHeader(other.token));
    expect(del.status).toBe(403);

    const ownDelete = await request(app)
      .delete(`/api/forum/posts/${reply.body.id}`)
      .set(authHeader(replier.token));
    expect(ownDelete.status).toBe(204);
  });
});

describe("forum editing", () => {
  it("lets the author edit their thread title and marks it edited", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId, "Antiguo");

    const res = await request(app)
      .patch(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(author.token))
      .send({ title: "Nuevo título" });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Nuevo título");
    expect(res.body.editedAt).not.toBeNull();
  });

  it("forbids a non-author from editing a thread", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const other = await createUser({ role: "teacher" });
    const res = await request(app)
      .patch(`/api/forum/threads/${created.body.id}`)
      .set(authHeader(other.token))
      .send({ title: "Hackeado" });
    expect(res.status).toBe(403);
  });

  it("lets the author edit their post and marks it edited", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);
    const threadId = created.body.id;

    const replier = await createUser({ role: "teacher" });
    await assignTeacherToModule(replier, moduleId);
    const reply = await request(app)
      .post(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(replier.token))
      .send({ content: "Original" });
    expect(reply.status).toBe(201);

    const edit = await request(app)
      .patch(`/api/forum/posts/${reply.body.id}`)
      .set(authHeader(replier.token))
      .send({ content: "Corregido" });
    expect(edit.status).toBe(200);
    expect(edit.body.content).toBe("Corregido");
    expect(edit.body.editedAt).not.toBeNull();
  });

  it("forbids a non-author from editing a post", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const other = await createUser({ role: "teacher" });
    const posts = await request(app)
      .get(`/api/forum/threads/${created.body.id}/posts`)
      .set(authHeader(author.token));
    const postId = posts.body[0].id;

    const res = await request(app)
      .patch(`/api/forum/posts/${postId}`)
      .set(authHeader(other.token))
      .send({ content: "no" });
    expect(res.status).toBe(403);
  });
});

describe("forum pinning", () => {
  it("lets a coordinator pin a thread within their province and sorts it first", async () => {
    const province = await createProvince("P");
    const center = await createCenter(province);
    const moduleId = await createModule({ centerId: center });
    const author = await createUser({ role: "teacher", centerId: center, provinceId: province });

    const first = await openThread(author.token, moduleId, "Primero");
    await openThread(author.token, moduleId, "Segundo");

    const coordinator = await createUser({ role: "coordinator", provinceId: province });
    const pin = await request(app)
      .put(`/api/forum/threads/${first.body.id}/pinned`)
      .set(authHeader(coordinator.token))
      .send({ pinned: true });
    expect(pin.status).toBe(200);
    expect(pin.body.pinnedAt).not.toBeNull();

    const list = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(author.token));
    expect(list.status).toBe(200);
    expect(list.body[0].id).toBe(first.body.id);
    expect(list.body[0].pinnedAt).not.toBeNull();

    const unpin = await request(app)
      .put(`/api/forum/threads/${first.body.id}/pinned`)
      .set(authHeader(coordinator.token))
      .send({ pinned: false });
    expect(unpin.status).toBe(200);
    expect(unpin.body.pinnedAt).toBeNull();
  });

  it("records pin and unpin actions and restricts history to moderators", async () => {
    const province = await createProvince("Historial");
    const center = await createCenter(province);
    const moduleId = await createModule({ centerId: center });
    const author = await createUser({
      role: "teacher",
      centerId: center,
      provinceId: province,
    });
    const coordinator = await createUser({
      role: "coordinator",
      provinceId: province,
    });
    const thread = await openThread(author.token, moduleId, "Tema privado");

    await request(app)
      .put(`/api/forum/threads/${thread.body.id}/pinned`)
      .set(authHeader(coordinator.token))
      .send({ pinned: true })
      .expect(200);
    await request(app)
      .put(`/api/forum/threads/${thread.body.id}/pinned`)
      .set(authHeader(coordinator.token))
      .send({ pinned: false })
      .expect(200);

    const history = await request(app)
      .get(`/api/forum/modules/${moduleId}/moderation-history`)
      .set(authHeader(coordinator.token))
      .expect(200);
    expect(history.body).toHaveLength(2);
    expect(history.body.map((event: { action: string }) => event.action)).toEqual([
      "thread_unpinned",
      "thread_pinned",
    ]);
    expect(history.body[0]).toMatchObject({
      moduleId,
      actorId: coordinator.user.id,
      actorName: coordinator.user.name,
    });
    expect(history.body[0]).not.toHaveProperty("content");
    expect(history.body[0]).not.toHaveProperty("title");
    expect(
      (await request(app)
        .get(`/api/forum/modules/${moduleId}/moderation-history`)
        .set(authHeader(author.token))).status,
    ).toBe(403);
  });

  it("records moderator deletions but not ordinary author deletions", async () => {
    const province = await createProvince("Borrados");
    const center = await createCenter(province);
    const moduleId = await createModule({ centerId: center });
    const author = await createUser({
      role: "teacher",
      centerId: center,
      provinceId: province,
    });
    const coordinator = await createUser({
      role: "coordinator",
      provinceId: province,
    });
    const postThread = await openThread(author.token, moduleId, "Tema");
    const posts = await request(app)
      .get(`/api/forum/threads/${postThread.body.id}/posts`)
      .set(authHeader(author.token))
      .expect(200);
    await request(app)
      .delete(`/api/forum/posts/${posts.body[0].id}`)
      .set(authHeader(coordinator.token))
      .expect(204);

    const authorThread = await openThread(author.token, moduleId, "Borrado propio");
    await request(app)
      .delete(`/api/forum/threads/${authorThread.body.id}`)
      .set(authHeader(author.token))
      .expect(204);
    const moderatorThread = await openThread(author.token, moduleId, "Borrado moderado");
    await request(app)
      .delete(`/api/forum/threads/${moderatorThread.body.id}`)
      .set(authHeader(coordinator.token))
      .expect(204);

    const history = await request(app)
      .get(`/api/forum/modules/${moduleId}/moderation-history`)
      .set(authHeader(coordinator.token))
      .expect(200);
    expect(history.body.map((event: { action: string }) => event.action)).toEqual([
      "thread_deleted",
      "post_deleted",
    ]);
  });

  it("forbids the author (non-manager) from pinning their own thread", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);

    const res = await request(app)
      .put(`/api/forum/threads/${created.body.id}/pinned`)
      .set(authHeader(author.token))
      .send({ pinned: true });
    expect(res.status).toBe(403);
  });

  it("lets appointed module moderators moderate only their assigned forum", async () => {
    const provinceA = await createProvince("A");
    const provinceB = await createProvince("B");
    const centerA = await createCenter(provinceA);
    const centerB = await createCenter(provinceB);
    const moduleId = await createModule({ centerId: centerA });
    const admin = await createUser({ role: "superadmin" });
    const inScopeManager = await createUser({
      role: "coordinator",
      provinceId: provinceA,
    });
    const outOfScopeManager = await createUser({
      role: "coordinator",
      provinceId: provinceB,
    });
    const author = await createUser({ role: "teacher", centerId: centerA });
    const moderator = await createUser({ role: "teacher", centerId: centerB });
    const thread = await openThread(author.token, moduleId, "Moderación");
    expect(thread.status).toBe(201);
    expect(thread.body.canModerate).toBe(false);

    const memberPath = `/api/modules/${moduleId}/members/${moderator.user.id}`;
    await request(app)
      .post(`/api/modules/${moduleId}/members`)
      .set(authHeader(admin.token))
      .send({ userId: moderator.user.id })
      .expect(201);

    await request(app)
      .patch(memberPath)
      .set(authHeader(moderator.token))
      .send({ forumModerator: true })
      .expect(403);

    await request(app)
      .patch(memberPath)
      .set(authHeader(outOfScopeManager.token))
      .send({ forumModerator: true })
      .expect(403);

    const appointed = await request(app)
      .patch(memberPath)
      .set(authHeader(inScopeManager.token))
      .send({ forumModerator: true })
      .expect(200);
    expect(appointed.body).toMatchObject({
      role: "member",
      forumModerator: true,
    });

    const moduleList = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(inScopeManager.token))
      .expect(200);
    expect(
      moduleList.body.find((item: { id: number }) => item.id === moduleId)
        ?.canManageForumModerators,
    ).toBe(true);
    await request(app)
      .get(`/api/modules/${moduleId}/members`)
      .set(authHeader(inScopeManager.token))
      .expect(200);

    const moderatorModuleList = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(moderator.token))
      .expect(200);
    expect(
      moderatorModuleList.body.some((item: { id: number }) => item.id === moduleId),
    ).toBe(true);
    expect(
      moderatorModuleList.body.find((item: { id: number }) => item.id === moduleId)
        ?.canManageForumModerators,
    ).toBe(false);
    await request(app)
      .get(`/api/modules/${moduleId}/members`)
      .set(authHeader(outOfScopeManager.token))
      .expect(403);

    const threads = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(moderator.token))
      .expect(200);
    expect(threads.body.find((item: { id: number }) => item.id === thread.body.id)?.canModerate).toBe(true);

    await request(app)
      .put(`/api/forum/threads/${thread.body.id}/pinned`)
      .set(authHeader(moderator.token))
      .send({ pinned: true })
      .expect(200);

    const posts = await request(app)
      .get(`/api/forum/threads/${thread.body.id}/posts`)
      .set(authHeader(moderator.token))
      .expect(200);
    await request(app)
      .delete(`/api/forum/posts/${posts.body[0].id}`)
      .set(authHeader(moderator.token))
      .expect(204);

    await request(app)
      .patch(memberPath)
      .set(authHeader(inScopeManager.token))
      .send({ forumModerator: false })
      .expect(200);
    const revoked = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(moderator.token))
      .expect(200);
    expect(revoked.body.some((item: { id: number }) => item.id === moduleId)).toBe(false);
    await request(app)
      .put(`/api/forum/threads/${thread.body.id}/pinned`)
      .set(authHeader(moderator.token))
      .send({ pinned: false })
      .expect(403);
  });
});

describe("forum unread counters and mark-read", () => {
  it("counts unread posts and clears them after marking the thread read", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);
    const threadId = created.body.id;

    const reader = await createUser({ role: "teacher" });
    await assignTeacherToModule(reader, moduleId);

    // Before reading, the opening post is unread for the reader.
    const before = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(reader.token));
    const beforeThread = before.body.find((t: { id: number }) => t.id === threadId);
    expect(beforeThread.unreadCount).toBeGreaterThanOrEqual(1);

    // Mark read.
    const read = await request(app)
      .post(`/api/forum/threads/${threadId}/read`)
      .set(authHeader(reader.token));
    expect(read.status).toBe(204);

    const after = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(reader.token));
    const afterThread = after.body.find((t: { id: number }) => t.id === threadId);
    expect(afterThread.unreadCount).toBe(0);

    // A new reply makes it unread again.
    await request(app)
      .post(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(author.token))
      .send({ content: "Novedad" });

    const reborn = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(reader.token));
    const rebornThread = reborn.body.find((t: { id: number }) => t.id === threadId);
    expect(rebornThread.unreadCount).toBeGreaterThanOrEqual(1);
  });

  it("aggregates unread counts at the module level", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    await openThread(author.token, moduleId, "Tema A");

    const reader = await createUser({ role: "teacher" });
    await assignTeacherToModule(reader, moduleId);
    const modules = await request(app)
      .get("/api/forum/modules")
      .set(authHeader(reader.token));
    expect(modules.status).toBe(200);
    const mod = modules.body.find((m: { id: number }) => m.id === moduleId);
    expect(mod.unreadCount).toBeGreaterThanOrEqual(1);
  });
});

describe("forum search", () => {
  it("filters threads by title with the q query", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    await openThread(author.token, moduleId, "Practica de soldadura");
    await openThread(author.token, moduleId, "Examen final");

    const res = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId, q: "soldadura" })
      .set(authHeader(author.token));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Practica de soldadura");
  });
});

describe("forum reply notifications", () => {
  it("notifies the thread author when someone else replies", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId, "Pregunta");
    const threadId = created.body.id;

    const replier = await createUser({ role: "teacher" });
    await assignTeacherToModule(replier, moduleId);
    await request(app)
      .post(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(replier.token))
      .send({ content: "Te respondo" });

    // Allow the best-effort fire-and-forget notify to flush.
    await new Promise((r) => setTimeout(r, 200));

    const notifs = await request(app)
      .get("/api/notifications")
      .set(authHeader(author.token));
    expect(notifs.status).toBe(200);
    const found = (notifs.body as Array<{ type?: string }>).some(
      (n) => n.type === "forum_reply",
    );
    expect(found).toBe(true);
  });

  it("does not notify the replier about their own reply", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);
    const threadId = created.body.id;

    await request(app)
      .post(`/api/forum/threads/${threadId}/posts`)
      .set(authHeader(author.token))
      .send({ content: "Mi propia nota" });

    await new Promise((r) => setTimeout(r, 200));

    const notifs = await request(app)
      .get("/api/notifications")
      .set(authHeader(author.token));
    const found = (notifs.body as Array<{ type?: string }>).some(
      (n) => n.type === "forum_reply",
    );
    expect(found).toBe(false);
  });
});
