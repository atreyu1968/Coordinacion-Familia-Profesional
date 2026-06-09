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
