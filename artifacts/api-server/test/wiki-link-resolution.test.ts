import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import router from "../src/routes/nativeWiki";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), select: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(), lock: vi.fn(),
}));
vi.mock("@workspace/db", async (original) => ({
  ...await original<typeof import("@workspace/db")>(), db: { transaction: mocks.transaction },
}));
vi.mock("../src/middlewares/auth", async (original) => ({
  ...await original<typeof import("../src/middlewares/auth")>(),
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.get("x-test-role");
    if (!role) { res.sendStatus(401); return; }
    req.user = { id: 12, role } as NonNullable<express.Request["user"]>;
    next();
  },
}));

const app = express().use(express.json()).use(router);
const oldReview = {
  note: "Primera revisión", reviewedAt: "2026-10-01T12:00:00Z", reviewedBy: 3,
  incidentVersion: 1, checkStatus: "blocked", httpStatus: 403, redirectUrl: null,
};
const link = {
  id: 42, checkStatus: "redirected", httpStatus: 200, redirectUrl: "https://www.boe.es/new",
  incidentVersion: 2, resolvedAt: null, reviewHistory: [oldReview],
};
const path = "/wiki/link-reviews/42/resolve";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockResolvedValue([{ link }]);
  mocks.where.mockReturnValue({ for: mocks.lock });
  mocks.select.mockReturnValue({ from: () => ({ innerJoin: () => ({ where: mocks.where }) }) });
  mocks.set.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.transaction.mockImplementation(async (run) => run({ select: mocks.select, update: mocks.update }));
});

it.each(["superadmin", "coordinator"])("lets %s append a dated note without altering the source", async (role) => {
  const res = await request(app).post(path).set("x-test-role", role)
    .send({ note: "  Destino revisado. Conservar el original.  ", incidentVersion: 2 });
  expect(res.status).toBe(204);
  expect(mocks.lock).toHaveBeenCalledWith("update", expect.any(Object));
  const update = mocks.set.mock.calls[0]![0];
  expect(Object.keys(update).sort()).toEqual(["resolvedAt", "reviewHistory"]);
  expect(update.resolvedAt).toBeInstanceOf(Date);
  expect(update.reviewHistory).toEqual([oldReview, {
    note: "Destino revisado. Conservar el original.", reviewedAt: update.resolvedAt.toISOString(),
    reviewedBy: 12, incidentVersion: 2, checkStatus: "redirected", httpStatus: 200,
    redirectUrl: "https://www.boe.es/new",
  }]);
  expect(link.reviewHistory).toEqual([oldReview]);
  const filter = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]).sql;
  expect(filter).toContain('"wiki_pages"."module_id" is null');
  expect(filter).toContain("ARRAY['normativa']::text[]");
  expect(filter).toContain('"wiki_pages"."deleted_at" is null');
  expect(filter).toContain('"wiki_external_links"."deleted_at" is null');
});

it.each(["teacher", "department_head"])("denies %s without writing", async (role) => {
  expect((await request(app).post(path).set("x-test-role", role)
    .send({ note: "Revisado", incidentVersion: 2 })).status).toBe(403);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it("requires authentication", async () => {
  expect((await request(app).post(path).send({ note: "Revisado", incidentVersion: 2 })).status).toBe(401);
});
it.each([
  {}, { note: " ", incidentVersion: 2 }, { note: "x".repeat(2001), incidentVersion: 2 },
  { note: "Revisado", incidentVersion: -1 }, { note: "Revisado", incidentVersion: 2.5 },
])("rejects invalid input before accessing the database: %j", async (body) => {
  expect((await request(app).post(path).set("x-test-role", "coordinator").send(body)).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
it.each([
  { ...link, incidentVersion: 3 },
  { ...link, resolvedAt: new Date() },
  { ...link, checkStatus: "healthy" },
  { ...link, checkStatus: "unchecked" },
])("does not close a stale, duplicate, or recovered incident", async (current) => {
  mocks.lock.mockResolvedValue([{ link: current }]);
  expect((await request(app).post(path).set("x-test-role", "coordinator")
    .send({ note: "Revisado", incidentVersion: 2 })).status).toBe(409);
  expect(mocks.update).not.toHaveBeenCalled();
});
it("does not resolve a removed, module-only or untagged link", async () => {
  mocks.lock.mockResolvedValue([]);
  expect((await request(app).post(path).set("x-test-role", "coordinator")
    .send({ note: "Revisado", incidentVersion: 2 })).status).toBe(404);
  expect(mocks.update).not.toHaveBeenCalled();
});
