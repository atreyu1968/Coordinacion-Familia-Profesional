import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, expect, it, vi } from "vitest";
import router from "../src/routes/nativeWiki";

const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn(), orderBy: vi.fn() }));
vi.mock("@workspace/db", async (original) => ({
  ...await original<typeof import("@workspace/db")>(), db: { select: mocks.select },
}));
vi.mock("../src/middlewares/auth", async (original) => ({
  ...await original<typeof import("../src/middlewares/auth")>(),
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.get("x-test-role");
    if (!role) { res.status(401).json({ message: "No autenticado" }); return; }
    req.user = { id: 1, role } as NonNullable<express.Request["user"]>;
    next();
  },
}));

const app = express().use(router);
const row = {
  id: 42, title: "Título editado", url: "https://www.boe.es/original",
  createdAt: new Date("2026-01-01Z"), checkedAt: new Date("2026-10-27Z"),
  nextCheckAt: new Date("2026-11-03Z"), checkStatus: "missing", httpStatus: 410,
  redirectUrl: null, pageId: 100, pageTitle: "Contenido editado por el responsable",
  incidentVersion: 1, resolvedAt: null, reviewHistory: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.orderBy.mockResolvedValue([row]);
  mocks.where.mockReturnValue({ orderBy: mocks.orderBy });
  mocks.select.mockReturnValue({
    from: () => ({ innerJoin: () => ({ where: mocks.where }) }),
  });
});

it.each(["superadmin", "coordinator"])("permite revisar Normativa a %s con contrato y fechas válidos", async (role) => {
  const response = await request(app).get("/wiki/link-reviews").set("x-test-role", role);
  expect(response.status).toBe(200);
  expect(response.body).toEqual([{
    ...row, createdAt: row.createdAt.toISOString(),
    checkedAt: row.checkedAt.toISOString(), nextCheckAt: row.nextCheckAt.toISOString(),
  }]);
});

it.each(["teacher", "department_head"])("impide que %s consulte el listado de gestión", async (role) => {
  expect((await request(app).get("/wiki/link-reviews").set("x-test-role", role)).status).toBe(403);
  expect(mocks.select).not.toHaveBeenCalled();
});

it("exige autenticación", async () => {
  expect((await request(app).get("/wiki/link-reviews")).status).toBe(401);
  expect(mocks.select).not.toHaveBeenCalled();
});

it("excluye páginas de módulo, páginas y enlaces retirados y diagnósticos sin incidencias", async () => {
  await request(app).get("/wiki/link-reviews").set("x-test-role", "coordinator");
  const filter = new PgDialect().sqlToQuery(mocks.where.mock.calls[0]![0]).sql;
  expect(filter).toContain('"wiki_external_links"."deleted_at" is null');
  expect(filter).toContain('"wiki_pages"."deleted_at" is null');
  expect(filter).toContain('"wiki_pages"."module_id" is null');
  expect(filter).toContain(`ARRAY['normativa']::text[]`);
  expect(filter).toContain(`NOT IN ('healthy', 'unchecked')`);
});

it("devuelve una lista vacía sin inventar comprobaciones", async () => {
  mocks.orderBy.mockResolvedValue([]);
  expect((await request(app).get("/wiki/link-reviews").set("x-test-role", "superadmin")).body).toEqual([]);
});
