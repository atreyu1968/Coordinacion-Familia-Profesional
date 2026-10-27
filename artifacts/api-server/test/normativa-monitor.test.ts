import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, normativaPublicationsTable as publications, normativaSourcesTable as sources, notificationsTable, wikiPagesTable, wikiExternalLinksTable } from "@workspace/db";
import app from "../src/app";
import { signToken } from "../src/lib/auth";
import { checkNormativa } from "../src/lib/normativaMonitor";
import * as feeds from "../src/lib/normativaFeeds";

const family = vi.hoisted(() => ({ value: "Administración y Gestión" }));
vi.mock("../src/lib/settings", async (original) => ({
  ...await original<typeof import("../src/lib/settings")>(), getActiveFamily: async () => family.value,
}));
vi.mock("../src/lib/push", () => ({ sendPushToUsers: vi.fn(async () => {}), withPushPath: (v: unknown) => v }));
// Profile onboarding is tested separately; exercise real tokens, active accounts,
// and wiki-management authorization here without creating teaching assignments.
vi.mock("../src/lib/teachingProfileAccess", async (original) => ({
  ...await original<typeof import("../src/lib/teachingProfileAccess")>(), hasCompleteTeachingProfile: async () => true,
}));

let admin: string;
let coordinator: string;
let reader: string;
let adminId: number;
let pageId: number;
const now = new Date("2026-10-27T12:00:00Z");
const boe = (items: { id: number; title: string }[]) => JSON.stringify({ status: { code: "200" }, data: { sumario: { diario: { seccion: items.map((i) => ({ item: { identificador: `BOE-A-2026-${i.id}`, titulo: i.title } })) } } } });
const archive = '<a href="/boc/2026/215/index.html" title="BOC (2026-10-27)">BOC</a>';

function network(items = [{ id: 9001, title: "Ordenación del sistema de Formación Profesional" }]) {
  return vi.spyOn(feeds, "officialFetch").mockImplementation(async (url) => {
    if (url.includes("/sumario/")) return { status: 200, body: boe(items) };
    if (url.includes("/boc/archivo/")) return { status: 200, body: archive };
    if (url.includes("215/index.html")) return { status: 200, body: 'BOC-S-2026-215 <li class="justificado_boc"><a href="https://sede.gobiernodecanarias.org/boc/boc-a-2026-215-9002.pdf">Resolución de Formación Profesional en Administración y Gestión</a><a href="/boc/2026/215/9002.html">HTML</a></li>' };
    if (url.includes("/boc/2026/215/9002.html")) return { status: 200, body: "<p>Administración y Gestión</p>" };
    if (url.includes("9004")) return { status: 200, body: "<documento><texto>Solo Informática y Comunicaciones</texto></documento>" };
    return { status: 200, body: "<documento><texto>Disposiciones de Formación Profesional</texto></documento>" };
  });
}

beforeAll(async () => {
  const identity = await db.execute(sql`select current_database() as name, inet_server_addr() as addr, current_setting('unix_socket_directories') as socket`);
  const row = identity.rows[0];
  if (process.env.COORDINA_NORMATIVA_ISOLATED !== "1" || row?.name !== "coordina_normativa" || row?.addr !== null || !String(row?.socket).startsWith("/tmp/coordina-normativa.")) {
    throw new Error("Run scripts/test-normativa.sh: refusing writes to a shared database");
  }
  const tokens: string[] = [];
  for (const role of ["superadmin", "coordinator", "prospector"] as const) {
    const [user] = await db.insert(usersTable).values({ name: role, email: `${role}@normativa.invalid`, passwordHash: "not-a-login-password", role, status: "active" }).returning();
    if (role === "superadmin") adminId = user!.id;
    tokens.push(signToken({ sub: user!.id, role, tokenVersion: user!.tokenVersion, sessionNonce: user!.sessionNonce }));
  }
  [admin, coordinator, reader] = tokens;
  const [page] = await db.insert(wikiPagesTable).values({ title: "Normativa editada", content: "Contenido humano que no se debe alterar", createdBy: adminId, updatedBy: adminId }).returning();
  pageId = page!.id;
});
beforeEach(async () => {
  vi.restoreAllMocks();
  family.value = "Administración y Gestión";
  await db.delete(notificationsTable);
  await db.delete(publications);
  await db.delete(sources);
  await db.delete(wikiExternalLinksTable);
});

describe("seguimiento, avisos y revisión humana", () => {
  it("deduplica entre ejecuciones y avisos; no toca documentación editada", async () => {
    network();
    await Promise.all([checkNormativa(now), checkNormativa(now)]);
    await checkNormativa(now);
    const rows = await db.select().from(publications);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "pending" && r.reviewedAt === null)).toBe(true);
    const notices = await db.select().from(notificationsTable);
    expect(notices).toHaveLength(4); // two publications × two general wiki managers
    expect(new Set(notices.map((r) => r.userId)).size).toBe(2);
    expect(notices.every((r) => r.target?.kind === "normativa")).toBe(true);
    const [page] = await db.select().from(wikiPagesTable).where(eq(wikiPagesTable.id, pageId));
    expect(page!.content).toBe("Contenido humano que no se debe alterar");
    const states = await db.select().from(sources);
    expect(states.every((r) => r.coveredThrough === "2026-10-27" && r.succeededAt != null)).toBe(true);
  });
  it("respeta las referencias iniciales y no avisa de otra familia", async () => {
    await db.insert(wikiExternalLinksTable).values({ pageId, title: "Base conocida FP", url: "https://www.boe.es/buscar/act.php?id=BOE-A-2026-9001", createdBy: adminId });
    network([
      { id: 9001, title: "Ordenación de Formación Profesional" },
      { id: 9004, title: "Modificación de Formación Profesional de la familia profesional de Informática y Comunicaciones" },
    ]);
    await checkNormativa(now);
    const rows = await db.select().from(publications);
    expect(rows.find((r) => r.officialId.endsWith("9001"))!.status).toBe("catalog");
    expect(rows.find((r) => r.officialId.endsWith("9004"))!.relevance).toBe("other");
    expect(await db.select().from(notificationsTable)).toHaveLength(2); // only BOC ADG
  });
  it("no adelanta el cursor cuando BOE falla y recupera los días pendientes", async () => {
    const fetch = network();
    const normal = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, accept) => {
      if (url.endsWith("/20261023")) throw new Error("Fuente temporalmente no disponible");
      return normal(url, accept);
    });
    await checkNormativa(now);
    const [failed] = await db.select().from(sources).where(eq(sources.source, "BOE"));
    expect(failed!.coveredThrough).toBe("2026-10-22");
    expect(failed!.succeededAt).toBeNull();
    expect(failed!.error).toContain("no disponible");
    fetch.mockImplementation(normal);
    await checkNormativa(now);
    const [recovered] = await db.select().from(sources).where(eq(sources.source, "BOE"));
    expect(recovered!.coveredThrough).toBe("2026-10-27");
    expect(recovered!.error).toBeNull();
    expect(await db.select().from(publications)).toHaveLength(2);
  });
  it("no omite silenciosamente una fuente no reconocida ni descarta textos inaccesibles", async () => {
    const fetch = network([{ id: 9004, title: "Formación Profesional de la familia profesional de Informática y Comunicaciones" }]);
    const normal = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (url, accept) => url.includes("xml.php") ? { status: 404, body: "" } : normal(url, accept));
    await checkNormativa(now);
    const [uncertain] = await db.select().from(publications).where(eq(publications.officialId, "BOE-A-2026-9004"));
    expect(uncertain!.relevance).toBe("uncertain");
    expect(await db.select().from(notificationsTable)).toHaveLength(4);
  });
  it("rechaza otra familia activa sin consultar fuentes", async () => {
    const fetch = network();
    family.value = "Sanidad";
    await checkNormativa(now);
    expect(fetch).not.toHaveBeenCalled();
    await request(app).post("/api/wiki/normativa/check").set("Authorization", `Bearer ${admin}`).expect(409);
  });
  it("limita la bandeja a gestores de wiki y conserva la primera revisión concurrente", async () => {
    await request(app).get("/api/wiki/normativa").expect(401);
    for (const path of ["/api/wiki/normativa", "/api/wiki/normativa/check"]) {
      await request(app)[path.endsWith("check") ? "post" : "get"](path).set("Authorization", `Bearer ${reader}`).expect(403);
    }
    const [publication] = await db.insert(publications).values({ source: "BOE", officialId: "BOE-A-2026-55", title: "FP", url: "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-55", relevance: "uncertain", reason: "Revisar" }).returning();
    const path = `/api/wiki/normativa/${publication!.id}/review`;
    await request(app).patch(path).set("Authorization", `Bearer ${reader}`).send({ status: "reviewed", reviewNote: "no", expectedStatus: "pending" }).expect(403);
    await request(app).patch(path).set("Authorization", `Bearer ${admin}`).send({ status: "reviewed", reviewNote: " ", expectedStatus: "pending" }).expect(400);
    const results = await Promise.all([admin, coordinator].map((token) => request(app).patch(path).set("Authorization", `Bearer ${token}`).send({ status: "reviewed", reviewNote: "Alcance comprobado; actualizar manualmente si procede", expectedStatus: "pending" })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const response = await request(app).get("/api/wiki/normativa?status=reviewed").set("Authorization", `Bearer ${coordinator}`).expect(200);
    expect(response.body.total).toBe(1);
    expect(response.body.items[0].reviewedAt).toBeTruthy();
    await request(app).get("/api/wiki/normativa?offset=-1").set("Authorization", `Bearer ${admin}`).expect(400);
  });
});
