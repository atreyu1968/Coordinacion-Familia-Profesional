import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { authHeader, cleanup, createUser, trackGroup } from "./helpers";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

afterAll(cleanup);

describe("direct chat role metadata", () => {
  it("reports the current counterpart role, not the caller's role or a stored display name", async () => {
    const caller = await createUser({ role: "superadmin" });
    const counterpart = await createUser({ role: "coordinator" });
    const created = await request(app).post("/api/chat/groups")
      .set(authHeader(caller.token))
      .send({ name: "Conversación", type: "direct", memberIds: [counterpart.user.id] }).expect(201);
    trackGroup(created.body.id);
    const list = () => request(app).get("/api/chat/groups").set(authHeader(caller.token));
    const response = await list().expect(200);
    expect(response.body.find((group: { id: number }) => group.id === created.body.id))
      .toMatchObject({ name: counterpart.user.name, directUserRole: "coordinator" });
    await db.update(usersTable).set({ role: "department_head" }).where(eq(usersTable.id, counterpart.user.id));
    const updated = await list().expect(200);
    expect(updated.body.find((group: { id: number }) => group.id === created.body.id))
      .toMatchObject({ directUserRole: "department_head" });
  });
});
