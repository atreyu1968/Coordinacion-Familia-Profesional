import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, eventsTable, meetingMinutesTable as minutes, meetingMinutesSourcesTable as sources, meetingAiSettingsTable } from "@workspace/db";
import app from "../src/app";
import { createUser, createProvince, cleanup, authHeader } from "./helpers";
import * as settings from "../src/lib/settings";
import * as acl from "../src/lib/objectAcl";
import { storage } from "../src/lib/meetingMinutes";
import { processOneMinutesJob } from "../src/lib/meetingMinutesWorker";

const fake = vi.hoisted(() => ({ process: vi.fn(async () => "Acuerdo documentado: revisar el catálogo."), draft: vi.fn(async () => "# Acta IA\nAcuerdo: revisar el catálogo. Plazo pendiente de confirmar.") }));
vi.mock("../src/lib/meetingMinutesMedia", () => ({ processMinutesSource: fake.process, draftMinutes: fake.draft }));
type Person = Awaited<ReturnType<typeof createUser>>;
let admin: Person, coordinator: Person, outside: Person, reader: Person, noProvince: Person;
let eventId: number, otherId: number, globalId: number;
const path = "/objects/uploads/11111111-1111-4111-8111-111111111111";
const call = (method: "get" | "put" | "post" | "delete", path: string, user = coordinator) => request(app)[method](`/api${path}`).set(authHeader(user.token));
const base = () => `/events/${eventId}/minutes`;
const current = async () => (await call("get", base())).body;
beforeAll(async () => {
  const province = await createProvince();
  admin = await createUser({ role: "superadmin" });
  coordinator = await createUser({ role: "coordinator", provinceId: province });
  outside = await createUser({ role: "coordinator", provinceId: await createProvince() });
  reader = await createUser({ role: "teacher", provinceId: province });
  noProvince = await createUser({ role: "coordinator", provinceId: null });
  [eventId, otherId, globalId] = (await db.insert(eventsTable).values([
    { name: "Prueba actas", type: "coordination_meeting", provinceId: province },
    { name: "Otra actividad", type: "other", provinceId: province },
    { name: "Reunión global", type: "coordination_meeting" },
  ]).returning({ id: eventsTable.id })).map(e => e.id);
  const existing = await settings.getSettings();
  vi.spyOn(settings, "getSettings").mockResolvedValue({ ...existing, deepseekApiKey: "test-not-sent" });
  vi.spyOn(storage, "getObjectEntityFile").mockResolvedValue({ kind: "local", absPath: "/tmp/not-read-minutes-test" });
  vi.spyOn(storage, "downloadObject").mockImplementation(async () => new Response("abc", { headers: { "content-length": "3" } }));
  vi.spyOn(storage, "trySetObjectEntityAclPolicy").mockResolvedValue(path);
  vi.spyOn(storage, "deleteObjectEntity").mockResolvedValue();
  vi.spyOn(acl, "getObjectAclPolicy").mockResolvedValue(null);
});
afterAll(async () => { vi.restoreAllMocks(); await db.delete(eventsTable).where(inArray(eventsTable.id, [eventId, otherId, globalId])); await cleanup(); });
describe("Actas de coordinación privadas y publicación revisada", () => {
  it("exige sesión y ámbito de gestión, y no activa actas de otros tipos", async () => {
    expect((await request(app).get(`/api${base()}`)).status).toBe(401);
    expect((await call("get", `/events/${otherId}/minutes`)).status).toBe(400);
    expect((await call("put", base(), reader).send({ revision: 0, enabled: true })).status).toBe(403);
    expect((await call("put", base(), outside).send({ revision: 0, enabled: true })).status).toBe(403);
    expect((await call("put", `/events/${globalId}/minutes`, noProvince).send({ revision: 0, enabled: true })).status).toBe(403);
    const result = await call("put", base()).send({ revision: 0, enabled: true });
    expect(result.status).toBe(200); expect(result.body.enabled).toBe(true);
  });
  it("guarda el borrador y rechaza revisiones antiguas sin perder datos", async () => {
    const w = await current();
    expect((await call("put", base()).send({ revision: w.revision, draftText: "Acta privada revisada" })).status).toBe(200);
    expect((await call("put", base()).send({ revision: w.revision, draftText: "Sobrescritura antigua" })).status).toBe(409);
    expect((await current()).draftText).toBe("Acta privada revisada");
    const publicView = (await call("get", base(), reader)).body;
    expect(publicView).toMatchObject({ canManage: false, draftText: null, publishedText: null, revision: 0, sources: [], messages: [] });
  });
  it("publica únicamente una instantánea revisada y permite retirarla", async () => {
    let w = await current();
    expect((await call("post", base() + "/publish").send({ revision: w.revision, publish: true, reviewed: false })).status).toBe(409);
    expect((await call("post", base() + "/publish").send({ revision: w.revision, publish: true, reviewed: true })).status).toBe(200);
    w = await current();
    await call("put", base()).send({ revision: w.revision, draftText: "Cambio aún no publicado" });
    expect((await call("get", base(), reader)).body.publishedText).toBe("Acta privada revisada");
    w = await current();
    await call("post", base() + "/publish").send({ revision: w.revision, publish: false, reviewed: false });
    expect((await call("get", base(), reader)).body.publishedText).toBeNull();
  });
  it("valida la subida, exige autorización y la protege con ACL del dominio", async () => {
    const data = { objectPath: path, fileName: "notas.txt", contentType: "text/plain", size: 3, purpose: "evidence", consent: true };
    expect((await call("post", base() + "/sources", reader).send(data)).status).toBe(403);
    expect((await call("post", base() + "/sources").send({ ...data, consent: false })).status).toBe(400);
    expect((await call("post", base() + "/sources").send({ ...data, objectPath: "/objects/../../private" })).status).toBe(400);
    const result = await call("post", base() + "/sources").send(data);
    expect(result.status).toBe(201);
    expect(result.body).not.toHaveProperty("objectPath");
    expect(storage.trySetObjectEntityAclPolicy).toHaveBeenCalledWith(path, { owner: `meeting-minutes:${eventId}`, visibility: "private" });
    expect((await call("get", base(), reader)).body.sources).toEqual([]);
    expect(await processOneMinutesJob()).toBe(true);
    expect((await current()).sources[0]).toMatchObject({ status: "ready", extractedText: "Acuerdo documentado: revisar el catálogo." });
  });
  it("redacta en segundo plano sin publicar ni exponer conversación o fuentes", async () => {
    let w = await current();
    const result = await call("post", base() + "/generate").send({ revision: w.revision, instructions: "Redacta con los acuerdos documentados.", consent: true });
    expect(result.status).toBe(202); expect(result.body.generationStatus).toBe("queued");
    expect((await call("post", base() + "/generate").send({ revision: w.revision, instructions: "Otra", consent: true })).status).toBe(409);
    await processOneMinutesJob(); w = await current();
    expect(w.draftText).toContain("Acta IA"); expect(w.generationStatus).toBe("idle");
    expect(w.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);
    expect((await call("get", base(), reader)).body).toMatchObject({ draftText: null, publishedText: null, sources: [], messages: [] });
  });
  it("no sobrescribe cambios manuales guardados durante una llamada a IA", async () => {
    const w = await current();
    await call("post", base() + "/generate").send({ revision: w.revision, instructions: "Revisa el acta.", consent: true });
    fake.draft.mockImplementationOnce(async () => {
      await db.update(minutes).set({ draftText: "Revisión humana guardada mientras IA trabaja", revision: w.revision + 1 }).where(eq(minutes.eventId, eventId));
      return "Resultado antiguo que no debe guardarse";
    });
    await processOneMinutesJob();
    const after = await current();
    expect(after.draftText).toContain("Revisión humana"); expect(after.generationStatus).toBe("error");
    expect(after.generationError).toContain("conservado");
  });
  it("recupera un procesamiento con lease vencido y permite reintentar errores", async () => {
    const source = (await current()).sources[0];
    await db.update(sources).set({ status: "processing", leaseToken: "servidor-anterior", leaseUntil: new Date(Date.now() - 1000) }).where(eq(sources.id, source.id));
    expect(await processOneMinutesJob()).toBe(true);
    fake.process.mockRejectedValueOnce(new Error("Fallo de transcripción simulado"));
    await db.update(sources).set({ status: "error", error: "Error anterior" }).where(eq(sources.id, source.id));
    expect((await call("post", base() + `/sources/${source.id}/retry`)).status).toBe(200);
    await processOneMinutesJob();
    expect((await current()).sources[0].status).toBe("error");
    await call("post", base() + `/sources/${source.id}/retry`); await processOneMinutesJob();
    expect((await current()).sources[0].status).toBe("ready");
  });
  it("desactivar conserva borrador y fuentes pero oculta lo publicado", async () => {
    let w = await current();
    await call("post", base() + "/publish").send({ revision: w.revision, publish: true, reviewed: true });
    w = await current();
    await call("put", base()).send({ revision: w.revision, enabled: false });
    expect((await current()).draftText).toContain("Revisión humana");
    expect((await current()).sources.length).toBe(1);
    expect((await call("get", base(), reader)).body.publishedText).toBeNull();
  });
  it("solo superadministración cambia configuración y nunca devuelve la clave", async () => {
    expect((await call("get", "/settings/meeting-ai", coordinator)).status).toBe(403);
    const result = await call("put", "/settings/meeting-ai", admin).send({ apiKey: "fake-not-a-secret", transcriptionModel: "gpt-4o-mini-transcribe", visionModel: "gpt-4o-mini" });
    expect(result.status).toBe(200); expect(result.body.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("fake-not-a-secret");
    expect((await call("put", "/settings/meeting-ai", admin).send({})).status).toBe(400);
    await db.delete(meetingAiSettingsTable);
  });
});
