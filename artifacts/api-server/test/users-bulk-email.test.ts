import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import { sendEmail } from "../src/lib/email";
import { authHeader, cleanup, createCenter, createProvince, createUser } from "./helpers";

vi.mock("../src/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/email")>();
  return { ...actual, sendEmail: vi.fn() };
});

beforeEach(() => {
  vi.mocked(sendEmail).mockReset().mockResolvedValue({ sent: true, pending: false });
});

afterAll(cleanup);

describe("bulk email from the user directory", () => {
  it("sends one private email per selected active recipient", async () => {
    const admin = await createUser({ role: "superadmin" });
    const first = await createUser({ name: "Destinatario Uno" });
    const second = await createUser({ name: "Destinatario Dos" });

    const response = await request(app)
      .post("/api/users/bulk-email")
      .set(authHeader(admin.token))
      .send({
        recipientIds: [first.user.id, second.user.id],
        subject: "Aviso de prueba",
        message: "Primera línea\nSegunda línea",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requested: 2,
      sent: 2,
      pending: 0,
      failed: 0,
    });
    expect(response.body.deliveries).toEqual(expect.arrayContaining([
      { userId: first.user.id, status: "sent" },
      { userId: second.user.id, status: "sent" },
    ]));
    expect(vi.mocked(sendEmail).mock.calls.map(([message]) => message.to).sort())
      .toEqual([first.email, second.email].sort());
    expect(vi.mocked(sendEmail).mock.calls.every(([message]) =>
      message.html.includes("Primera línea") && message.html.includes("Segunda línea"),
    )).toBe(true);
  });

  it("rejects malformed batches without sending", async () => {
    const admin = await createUser({ role: "superadmin" });
    const response = await request(app)
      .post("/api/users/bulk-email")
      .set(authHeader(admin.token))
      .send({ recipientIds: [admin.user.id, admin.user.id], subject: " ", message: " " });

    expect(response.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send to a recipient outside the coordinator's province", async () => {
    const coordinatorProvince = await createProvince("Provincia coordinador");
    const otherProvince = await createProvince("Otra provincia");
    const otherCenter = await createCenter(otherProvince);
    const coordinator = await createUser({ role: "coordinator", provinceId: coordinatorProvince });
    const otherTeacher = await createUser({ role: "teacher", provinceId: otherProvince, centerId: otherCenter });

    const response = await request(app)
      .post("/api/users/bulk-email")
      .set(authHeader(coordinator.token))
      .send({
        recipientIds: [otherTeacher.user.id],
        subject: "Aviso",
        message: "Mensaje",
      });

    expect(response.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
