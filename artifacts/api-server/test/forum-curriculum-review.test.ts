import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db, centersTable, trainingOfferTable, modulesTable, moduleLearningOutcomesTable as ra,
  moduleEvaluationCriteriaTable as ce, forumCollaborationsTable as configs,
  forumCollaborationRevisionsTable as revisions, forumThreadsTable,
} from "@workspace/db";
import type { ForumCurriculumInput } from "@workspace/api-zod";
import app from "../src/app";
import { createUser, createProvince, createCenter, createModule, cleanup, authHeader } from "./helpers";
import { curriculumKey } from "../src/lib/forumCurriculumReview";

const moduleIds: number[] = [];
let owner: Awaited<ReturnType<typeof createUser>>, teacher: typeof owner, coordinator: typeof owner;
const base = (id: number) => `/api/forum/modules/${id}/collaboration`;
const post = (id: number, action: string, data: unknown, user = owner) =>
  request(app).post(`${base(id)}/curriculum/${action}`).set(authHeader(user.token)).send(data);
const get = (id: number) => request(app).get(base(id)).set(authHeader(owner.token));
const history = (id: number, user = owner) =>
  request(app).get(`${base(id)}/curriculum/history`).set(authHeader(user.token));
const apply = (id: number, incoming: ForumCurriculumInput, token: string, selectedKeys: string[], patch = {}) =>
  post(id, "apply", { incoming, token, selectedKeys, confirmReviewed: true, ...patch });

beforeAll(async () => {
  owner = await createUser({ role: "superadmin" });
  teacher = await createUser({ role: "teacher" });
  coordinator = await createUser({ role: "coordinator" });
});
afterAll(async () => {
  if (moduleIds.length) {
    await db.delete(revisions).where(inArray(revisions.moduleId, moduleIds));
    await db.delete(configs).where(inArray(configs.moduleId, moduleIds));
  }
  await cleanup();
});

async function fixture() {
  const centerId = await createCenter(await createProvince("Revisión curricular de ensayo"));
  await db.update(centersTable).set({ families: ["Administración y Gestión"] }).where(eq(centersTable.id, centerId));
  const name = `Revisión de ensayo ${Date.now()}-${moduleIds.length}`;
  const cycleName = `${name} ciclo`;
  const id = await createModule({ name, code: `TEST-${moduleIds.length}`, cycleName, centerId: null });
  moduleIds.push(id);
  await db.insert(trainingOfferTable).values({ centerId, cycleName });
  const [outcome] = await db.insert(ra).values({ moduleId: id, code: "RA1", description: "Edición humana RA", order: 1 }).returning();
  const [criterion] = await db.insert(ce).values({ outcomeId: outcome.id, code: "1.a", description: "Edición humana CE", order: 1 }).returning();
  const state = (await get(id)).body;
  const configured = await request(app).put(base(id)).set(authHeader(owner.token)).send({
    revision: 0, fingerprint: state.fingerprint, enabled: false, officialCode: state.moduleCode,
    sourceTitle: "Normativa ficticia de ensayo", sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST",
    curriculumVersion: "ENSAYO-1", territory: "Canarias", confirmReviewed: true,
    sections: state.sections.map((s: any, i: number) => i ? s : { ...s, title: "Apartado editado por una persona", prompt: "Conservar esta plantilla humana" }),
  });
  expect(configured.status).toBe(200);
  const incoming: ForumCurriculumInput = {
    family: "Administración y Gestión", moduleName: name, cycleName, workbook: "ensayo.xlsx",
    officialCode: state.moduleCode, sourceTitle: "Nueva referencia de ensayo",
    sourceUrl: "https://www.boe.es/buscar/act.php?id=TEST-NUEVO",
    curriculumVersion: "ENSAYO-2", territory: "Canarias",
    outcomes: [{ code: "RA1", description: "Nuevo RA de la hoja", order: 1,
      criteria: [{ code: "1.a", description: "Nuevo CE de la hoja", order: 1 }] }],
  };
  return { id, outcome, criterion, incoming };
}

describe("Selected curriculum revisions", () => {
  it("previews codes, RA, CE and legislation without writes and restricts all three routes", async () => {
    const { id, incoming } = await fixture();
    incoming.officialCode += "-NUEVO";
    const before = (await get(id)).body;
    const preview = await post(id, "preview", incoming);
    expect(preview.status).toBe(200);
    expect(preview.body.changes.map((c: any) => c.key)).toEqual(expect.arrayContaining([
      curriculumKey("moduleCode"), curriculumKey("officialCode"), curriculumKey("ra", "RA1"),
      curriculumKey("ce", "RA1", "1.a"), curriculumKey("sourceTitle"), curriculumKey("sourceUrl"), curriculumKey("curriculumVersion"),
    ]));
    expect((await get(id)).body).toEqual(before);
    expect((await history(id)).body).toHaveLength(1);
    for (const user of [teacher, coordinator]) {
      expect((await post(id, "preview", incoming, user)).status).toBe(403);
      expect((await post(id, "apply", {}, user)).status).toBe(403);
      expect((await history(id, user)).status).toBe(403);
    }
    expect((await request(app).post(`${base(id)}/curriculum/preview`).send(incoming)).status).toBe(401);
  });

  it("applies only selected changes, preserves human RA and template, and audits both snapshots", async () => {
    const { id, outcome, criterion, incoming } = await fixture();
    const preview = await post(id, "preview", incoming);
    const selected = [curriculumKey("ce", "RA1", "1.a"), curriculumKey("curriculumVersion")];
    expect((await apply(id, incoming, preview.body.token, selected, { confirmReviewed: false })).status).toBe(400);
    expect((await apply(id, incoming, preview.body.token, ["inventado"])).status).toBe(400);
    expect((await apply(id, incoming, preview.body.token, selected)).status).toBe(200);
    expect((await db.select().from(ra).where(eq(ra.id, outcome.id)))[0].description).toBe("Edición humana RA");
    expect((await db.select().from(ce).where(eq(ce.id, criterion.id)))[0].description).toBe("Nuevo CE de la hoja");
    const state = (await get(id)).body;
    expect(state.enabled).toBe(false);
    expect(state.verificationCurrent).toBe(false);
    expect(state.sections[0].title).toBe("Apartado editado por una persona");
    expect(state.sections[0].prompt).toBe("Conservar esta plantilla humana");
    expect(await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.moduleId, id))).toHaveLength(0);
    const entries = (await history(id)).body;
    expect(entries).toHaveLength(2);
    expect(entries[0].actorName).toBe(owner.user.name);
    const audit = JSON.parse(entries[0].configuration).curriculumReview;
    expect(audit.selectedKeys).toEqual(selected);
    expect(audit.before.criteria[0].description).toBe("Edición humana CE");
    expect(audit.after.criteria[0].description).toBe("Nuevo CE de la hoja");
    expect((await apply(id, incoming, preview.body.token, selected)).status).toBe(409);
  });

  it("rejects stale RA edits and changed proposals, then accepts a fresh full review atomically once", async () => {
    const { id, outcome, incoming } = await fixture();
    const old = (await post(id, "preview", incoming)).body;
    await db.update(ra).set({ description: "Edición humana posterior a la comparación" }).where(eq(ra.id, outcome.id));
    expect((await apply(id, incoming, old.token, old.changes.map((c: any) => c.key))).status).toBe(409);
    const fresh = (await post(id, "preview", incoming)).body;
    expect((await apply(id, { ...incoming, curriculumVersion: "NO COMPARADA" }, fresh.token, fresh.changes.map((c: any) => c.key))).status).toBe(409);
    const results = await Promise.all([1, 2].map(() =>
      apply(id, incoming, fresh.token, fresh.changes.map((c: any) => c.key))));
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const state = (await get(id)).body;
    expect(state.verificationCurrent).toBe(true);
    expect(state.enabled).toBe(false);
    expect((await history(id)).body).toHaveLength(2);
  });

  it("archives removed identities, preserves the old text, and does not resurrect tombstones", async () => {
    const { id, outcome, criterion, incoming } = await fixture();
    incoming.outcomes[0].code = "RA2";
    const preview = (await post(id, "preview", incoming)).body;
    const result = await apply(id, incoming, preview.token, preview.changes.map((c: any) => c.key));
    expect(result.status).toBe(200);
    const archived = (await db.select().from(ra).where(eq(ra.id, outcome.id)))[0];
    expect(archived.deletedAt).not.toBeNull();
    expect(archived.description).toBe("Edición humana RA");
    expect((await db.select().from(ce).where(eq(ce.id, criterion.id)))[0].deletedAt).not.toBeNull();
    incoming.outcomes[0].code = "RA1";
    expect((await post(id, "preview", incoming)).status).toBe(409);
  });

  it("rejects other families, mismatched cycle identities, unsafe URLs and duplicate codes", async () => {
    const { id, incoming } = await fixture();
    for (const patch of [
      { family: "Otra familia" }, { cycleName: "Otro ciclo" }, { moduleName: "Otro módulo" },
      { sourceUrl: "https://www.boe.es.ejemplo.org/texto" },
      { sourceUrl: "https://www.boe.es/?token=privado" },
      { outcomes: [...incoming.outcomes, ...incoming.outcomes] },
      { outcomes: [{ ...incoming.outcomes[0], criteria: [incoming.outcomes[0].criteria[0], incoming.outcomes[0].criteria[0]] }] },
    ]) expect((await post(id, "preview", { ...incoming, ...patch })).status).toBe(400);
  });
});
