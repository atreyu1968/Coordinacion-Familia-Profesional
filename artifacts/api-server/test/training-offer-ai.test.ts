import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, centersTable, cyclesTable, trainingOfferTable } from "@workspace/db";
import { cleanup, createCenter, createProvince, createUser, authHeader } from "./helpers";
import { applyTrainingOffer } from "../src/lib/trainingOfferImport";
import { analyzeTrainingOffer, sealOfferPreview, type OfferContext, type ImportedOfferRow } from "../src/lib/trainingOfferAi";
import { cycleOfferName } from "../src/lib/trainingOfferOfficial";
import * as official from "../src/lib/trainingOfferOfficial";
import * as settings from "../src/lib/settings";
import * as minutes from "../src/lib/meetingMinutes";
import app from "../src/app";

const mocked = vi.hoisted(() => ({ client: vi.fn(), create: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  constructor(options: unknown) { mocked.client(options); }
  chat = { completions: { create: mocked.create } };
} }));
const cycleIds: number[] = []; const centerIds: number[] = [];
afterEach(() => { vi.restoreAllMocks(); mocked.client.mockReset(); mocked.create.mockReset(); });
afterAll(async () => {
  if (centerIds.length) await db.delete(trainingOfferTable).where(inArray(trainingOfferTable.centerId, centerIds));
  if (cycleIds.length) await db.delete(cyclesTable).where(inArray(cyclesTable.id, cycleIds));
  await cleanup();
});
async function fixture() {
  const admin = await createUser({ role: "superadmin" });
  const province = await createProvince("Oferta IA");
  const centerId = await createCenter(province); centerIds.push(centerId);
  const otherCenterId = await createCenter(province); centerIds.push(otherCenterId);
  const schoolYear = (await settings.getActiveAcademicYear())!;
  const family = await settings.getActiveFamily();
  expect(schoolYear).toBeTruthy();
  await db.update(centersTable).set({ code: "35999121", families: [family] }).where(eq(centersTable.id, centerId));
  await db.update(centersTable).set({ code: "35999122", families: [family] }).where(eq(centersTable.id, otherCenterId));
  const [cycle] = await db.insert(cyclesTable).values({ name: `Ciclo de ensayo ${randomUUID()}`, level: "Grado Medio" }).returning();
  cycleIds.push(cycle!.id);
  // Family membership for an allowed custom cycle derives from an earlier offer.
  await db.insert(trainingOfferTable).values({ centerId, cycleId: cycle!.id, cycleName: cycle!.name, schoolYear: "1999/2000" });
  const [center] = await db.select().from(centersTable).where(eq(centersTable.id, centerId));
  const sourceUrl = "https://www.gobiernodecanarias.org/educacion/oferta-ensayo";
  const context: OfferContext = { kind: "context", contextId: randomUUID(), ownerId: admin.user.id, schoolYear, family,
    centers: [{ id: centerId, name: center!.name, code: "35999121" }, { id: otherCenterId, name: "Otro centro de ensayo", code: "35999122" }],
    cycles: [{ id: cycle!.id, name: cycle!.name, level: cycle!.level }], sources: [sourceUrl] };
  const row: ImportedOfferRow = { centerId, centerCode: "35999121", centerName: center!.name, cycleId: cycle!.id,
    cycleName: cycle!.name, level: cycle!.level, sourceUrl, evidence: `35999121 ${cycle!.name}` };
  const tokens = (rows = [row], override: Partial<OfferContext> = {}) => {
    const c = { ...context, ...override };
    return { contextToken: sealOfferPreview(c), resultTokens: [
      sealOfferPreview({ kind: "result", contextId: c.contextId, ownerId: c.ownerId, rows }),
    ] };
  };
  return { admin, context, row, tokens, centerId, cycle: cycle! };
}

describe("reviewed training offer import", () => {
  it("adds only the active year's missing cycles, preserves manual and historic offers, and is idempotent", async () => {
    const f = await fixture();
    const [manual] = await db.insert(trainingOfferTable).values({ centerId: f.centerId, cycleName: "Oferta manual",
      schoolYear: f.context.schoolYear, shift: "Tarde" }).returning();
    const tokens = f.tokens();
    const first = await applyTrainingOffer(f.admin.user.id, tokens.contextToken, tokens.resultTokens);
    expect(first).toMatchObject({ added: 1, unchanged: 0, matchedCenters: 1 });
    expect(first.pendingCenters).toHaveLength(1);
    const second = await applyTrainingOffer(f.admin.user.id, tokens.contextToken, tokens.resultTokens);
    expect(second).toMatchObject({ added: 0, unchanged: 1 });
    const rows = await db.select().from(trainingOfferTable).where(eq(trainingOfferTable.centerId, f.centerId));
    expect(rows).toHaveLength(3);
    expect(rows.find(r => r.id === manual!.id)).toMatchObject({ shift: "Tarde", deletedAt: null });
    expect(rows.filter(r => r.schoolYear === "1999/2000")).toHaveLength(1);
  });
  it("refuses a changed active year without touching any offer", async () => {
    const f = await fixture(); const tokens = f.tokens(undefined, { schoolYear: "1998/1999" });
    await expect(applyTrainingOffer(f.admin.user.id, tokens.contextToken, tokens.resultTokens)).rejects.toThrow("han cambiado");
    expect(await db.select().from(trainingOfferTable).where(eq(trainingOfferTable.centerId, f.centerId))).toHaveLength(1);
  });
  it("rechecks center family membership and rolls back the whole batch on an unavailable cycle", async () => {
    const f = await fixture();
    const bad = { ...f.row, cycleId: 2147483647, cycleName: "Fuera del catálogo" };
    const tokens = f.tokens([f.row, bad]);
    await expect(applyTrainingOffer(f.admin.user.id, tokens.contextToken, tokens.resultTokens)).rejects.toThrow("Ha cambiado");
    expect(await db.select().from(trainingOfferTable).where(and(eq(trainingOfferTable.centerId, f.centerId),
      eq(trainingOfferTable.schoolYear, f.context.schoolYear)))).toHaveLength(0);
    await db.update(centersTable).set({ families: ["Otra familia"] }).where(eq(centersTable.id, f.centerId));
    const valid = f.tokens();
    await expect(applyTrainingOffer(f.admin.user.id, valid.contextToken, valid.resultTokens)).rejects.toThrow("Ha cambiado");
  });
  it("does not duplicate a current legacy offer lacking a catalog ID", async () => {
    const f = await fixture();
    await db.insert(trainingOfferTable).values({ centerId: f.centerId, cycleName: f.cycle.name,
      schoolYear: f.context.schoolYear, cycleId: null, shift: "Mañana" });
    const tokens = f.tokens();
    expect(await applyTrainingOffer(f.admin.user.id, tokens.contextToken, tokens.resultTokens)).toMatchObject({ added: 0, unchanged: 1 });
  });
  it("accepts a signed review larger than the general JSON limit through the authenticated endpoint", async () => {
    const f = await fixture();
    const tokens = f.tokens(undefined, { centers: [{ ...f.context.centers[0]!, name: "Centro ".repeat(18000) }] });
    expect(tokens.contextToken.length).toBeGreaterThan(100 * 1024);
    const response = await request(app).post("/api/centers/training-offer/ai/apply")
      .set(authHeader(f.admin.token)).send(tokens).expect(200);
    expect(response.body).toMatchObject({ added: 1, unchanged: 0, schoolYear: f.context.schoolYear });
  });
  it("denies ordinary teachers and missing authentication for all three endpoints", async () => {
    const teacher = await createUser({ role: "teacher" });
    for (const operation of ["discover", "analyze", "apply"]) {
      await request(app).post(`/api/centers/training-offer/ai/${operation}`).send({}).expect(401);
      await request(app).post(`/api/centers/training-offer/ai/${operation}`).set(authHeader(teacher.token)).send({}).expect(403);
    }
  });
  it.each(["deepseek", "openai"])("uses the configured %s API and returns evidenced rows without saving", async provider => {
    const f = await fixture();
    vi.spyOn(settings, "getSettings").mockResolvedValue({ deepseekApiKey: provider === "deepseek" ? "test-only" : null } as Awaited<ReturnType<typeof settings.getSettings>>);
    vi.spyOn(settings, "getActiveAcademicYear").mockResolvedValue(f.context.schoolYear);
    vi.spyOn(settings, "getActiveFamily").mockResolvedValue(f.context.family);
    vi.spyOn(minutes, "aiConfig").mockResolvedValue({ id: 1, apiKey: "test-only", transcriptionModel: "unused", visionModel: "configured-model" });
    const evidence = `35999121 ${cycleOfferName(f.cycle.name)}`;
    vi.spyOn(official, "readOfficialOffer").mockResolvedValue({ url: f.row.sourceUrl,
      heading: `Curso ${f.context.schoolYear}`, text: `${f.context.family}\n${evidence}`, links: [] });
    mocked.create.mockResolvedValue({ choices: [{ finish_reason: "stop",
      message: { content: JSON.stringify({ offers: [{ centerCode: "35999121", cycleId: f.cycle.id, evidence }] }) } }] });
    const result = await analyzeTrainingOffer(f.admin.user.id, f.tokens().contextToken, f.row.sourceUrl);
    expect(result.rows).toHaveLength(1);
    expect(mocked.client.mock.calls[0][0].baseURL).toBe(provider === "deepseek" ? "https://api.deepseek.com" : "https://api.openai.com/v1");
    expect(mocked.create.mock.calls[0][0].model).toBe(provider === "deepseek" ? "deepseek-chat" : "configured-model");
    expect(await db.select().from(trainingOfferTable).where(eq(trainingOfferTable.centerId, f.centerId))).toHaveLength(1);
  });
});
