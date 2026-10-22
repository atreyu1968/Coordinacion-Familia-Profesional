import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { coordinatorTasksTable, db } from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createUser } from "./helpers";

afterAll(async () => {
  await cleanup();
});

describe("coordinator task privacy and lifecycle", () => {
  it("requires an authenticated coordinator", async () => {
    const anonymous = await request(app).get("/api/coordinator-tasks");
    expect(anonymous.status).toBe(401);

    const teacher = await createUser({ role: "teacher" });
    const forbidden = await request(app)
      .get("/api/coordinator-tasks")
      .set(authHeader(teacher.token));
    expect(forbidden.status).toBe(403);
  });

  it("keeps manual tasks private to their coordinator", async () => {
    const owner = await createUser({ role: "coordinator" });
    const other = await createUser({ role: "coordinator" });
    const created = await request(app)
      .post("/api/coordinator-tasks")
      .set(authHeader(owner.token))
      .send({ title: "Enviar el resumen", description: "Recoger los acuerdos." });

    expect(created.status).toBe(201);
    expect(created.body.sourceType).toBe("manual");
    expect(created.body.reviewStatus).toBe("accepted");

    const ownList = await request(app)
      .get("/api/coordinator-tasks")
      .set(authHeader(owner.token));
    expect(ownList.status).toBe(200);
    expect(ownList.body.tasks).toHaveLength(1);
    expect(ownList.body.tasks[0].title).toBe("Enviar el resumen");

    const otherList = await request(app)
      .get("/api/coordinator-tasks")
      .set(authHeader(other.token));
    expect(otherList.status).toBe(200);
    expect(otherList.body.tasks).toHaveLength(0);

    const otherUpdate = await request(app)
      .patch(`/api/coordinator-tasks/${created.body.id}`)
      .set(authHeader(other.token))
      .send({ revision: 1, status: "resolved", resolution: "Listo." });
    expect(otherUpdate.status).toBe(404);
  });

  it("requires a resolution and rejects stale updates", async () => {
    const coordinator = await createUser({ role: "coordinator" });
    const created = await request(app)
      .post("/api/coordinator-tasks")
      .set(authHeader(coordinator.token))
      .send({ title: "Contactar con el centro" });
    expect(created.status).toBe(201);

    const started = await request(app)
      .patch(`/api/coordinator-tasks/${created.body.id}`)
      .set(authHeader(coordinator.token))
      .send({ revision: 1, status: "in_progress" });
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("in_progress");
    expect(started.body.revision).toBe(2);

    const unresolved = await request(app)
      .patch(`/api/coordinator-tasks/${created.body.id}`)
      .set(authHeader(coordinator.token))
      .send({ revision: 2, status: "resolved" });
    expect(unresolved.status).toBe(400);

    const resolved = await request(app)
      .patch(`/api/coordinator-tasks/${created.body.id}`)
      .set(authHeader(coordinator.token))
      .send({ revision: 2, status: "resolved", resolution: "La coordinación envió la información." });
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolution).toBe("La coordinación envió la información.");

    const stale = await request(app)
      .patch(`/api/coordinator-tasks/${created.body.id}`)
      .set(authHeader(coordinator.token))
      .send({ revision: 2, status: "pending" });
    expect(stale.status).toBe(409);
  });

  it("requires explicit review before managing an AI suggestion", async () => {
    const coordinator = await createUser({ role: "coordinator" });
    const [suggestion] = await db.insert(coordinatorTasksTable).values({
      ownerId: coordinator.user.id,
      title: "Enviar el acta",
      description: "La fuente indica que falta enviarla.",
      status: "pending",
      reviewStatus: "suggested",
      sourceType: "minutes",
      sourceId: "event-test",
      sourceFingerprint: "test-fingerprint",
      sourceLabel: "Reunión de coordinación",
    }).returning();

    const unreviewed = await request(app)
      .patch(`/api/coordinator-tasks/${suggestion!.id}`)
      .set(authHeader(coordinator.token))
      .send({ revision: 1, status: "in_progress" });
    expect(unreviewed.status).toBe(409);

    const accepted = await request(app)
      .patch(`/api/coordinator-tasks/${suggestion!.id}`)
      .set(authHeader(coordinator.token))
      .send({ revision: 1, reviewStatus: "accepted" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.reviewStatus).toBe("accepted");
    expect(accepted.body.revision).toBe(2);
  });
});
