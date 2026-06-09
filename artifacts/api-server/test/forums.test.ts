import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  createUser,
  createProvince,
  createCenter,
  createModule,
  cleanup,
  authHeader,
  trackThread,
} from "./helpers";

afterAll(async () => {
  await cleanup();
});

// Open a thread via the API and track it for cleanup.
async function openThread(
  token: string,
  moduleId: number,
  title = "Tema de prueba",
  content = "Mensaje inicial",
) {
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

  it("lets global modules be read by anyone", async () => {
    const moduleId = await createModule({ centerId: null });
    const someone = await createUser({ role: "teacher" });
    const res = await request(app)
      .get("/api/forum/threads")
      .query({ moduleId })
      .set(authHeader(someone.token));
    expect(res.status).toBe(200);
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
});

describe("forum unread counters and mark-read", () => {
  it("counts unread posts and clears them after marking the thread read", async () => {
    const moduleId = await createModule({ centerId: null });
    const author = await createUser({ role: "teacher" });
    const created = await openThread(author.token, moduleId);
    const threadId = created.body.id;

    const reader = await createUser({ role: "teacher" });

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
