/**
 * Run: bash deploy/test-db.sh --ai-knowledge-only
 *
 * Real PostgreSQL, real collection/synchronization/retrieval/worker and real
 * Nextcloud OCS/WebDAV parsing. Only remote I/O and document extraction are
 * replaced. No app database connection or fixture writes before the guard.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import type { User } from "@workspace/db";

const draftCompletion = vi.hoisted(() => vi.fn(async (_request: unknown) => ({
  choices: [{ finish_reason: "stop", message: { content: "Borrador seguro de prueba" } }],
})));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: draftCompletion } };
  },
}));
vi.mock("../src/lib/settings", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/lib/settings")>();
  return {
    ...actual,
    getSettings: async () => ({
      ...await actual.getSettings(),
      nextcloudUrl: "https://nextcloud.example.test",
      nextcloudAdminUser: "test-reader",
      nextcloudAdminPassword: "test-only-not-a-credential",
      deepseekApiKey: "test-only-not-a-credential",
    }),
  };
});
vi.mock("../src/lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile(path: string) { return path; }
    async downloadObject(path: string) { return new Response(`aislamiento ${path}`); }
  },
}));
vi.mock("../src/lib/meetingMinutesMedia", () => ({
  processMaterialBytes: async (_name: string, bytes: Buffer) => bytes.toString("utf8"),
}));

let t: typeof import("@workspace/db");
let ai: typeof import("../src/lib/aiKnowledge");
let nc: typeof import("../src/lib/nextcloud");
let a: User, b: User;
let pa: number, pb: number, ca: number, cb: number, ma: number, mb: number;
let folders: Array<{ id: number; mount_point: string; groups: Record<string, number>; acl?: boolean | number | string; advanced_permissions?: boolean | number | string }>;
let requests: string[];
let remoteDown: boolean;

beforeAll(async () => {
  // Check the runner-created private socket *before importing the DB client*.
  const root = process.env.COORDINA_AI_TEST_ROOT;
  if (!root || !/\/coordina-db-test\.[a-zA-Z0-9]+$/.test(root)) {
    throw new Error("Use bash deploy/test-db.sh --ai-knowledge-only; an isolated cluster is required.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/coordina_ai_knowledge" ||
      url.searchParams.get("host") !== join(root, "socket") ||
      realpathSync(root) !== root) {
    throw new Error("Refusing to connect outside the runner's temporary PostgreSQL socket.");
  }
  t = await import("@workspace/db");
  const identity = await t.db.execute(sql`SELECT current_database() AS name, current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listeners`);
  expect(identity.rows[0]).toEqual({
    name: "coordina_ai_knowledge", directory: join(root, "data"), listeners: "",
  });
  vi.stubEnv("JWT_SECRET", "isolated-ai-regression-test-key-not-for-production");
  ai = await import("../src/lib/aiKnowledge");
  nc = await import("../src/lib/nextcloud");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await t?.pool.end();
});

beforeEach(async () => {
  // This database belongs solely to this suite; the server identity was checked
  // above. Never reuse the application's shared fixture cleanup machinery.
  const tables = await t.db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  const names = tables.rows.map(row => `"${String(row.tablename).replaceAll('"', '""')}"`);
  await t.db.execute(sql.raw(`TRUNCATE ${names.join(",")} RESTART IDENTITY CASCADE`));
  folders = []; requests = []; remoteDown = false;
  draftCompletion.mockClear();
  vi.stubEnv("NEXTCLOUD_ADMIN_URL", "");
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(`${init?.method ?? "GET"} ${url}`);
    if (remoteDown) throw new Error("Simulated storage outage");
    if (url.endsWith("/ocs/v2.php/apps/groupfolders/folders?format=json")) {
      return Response.json({ ocs: { meta: { statuscode: 100 }, data: folders } });
    }
    const match = url.match(/\/remote\.php\/dav\/groupfolders\/(\d+)\/(.*)$/);
    if (!match) throw new Error("Unexpected external request in isolation suite");
    const [, folder, path] = match;
    if (init?.method === "PROPFIND") {
      return new Response(`<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
        <d:response><d:href>/remote.php/dav/groupfolders/${folder}/file.txt</d:href>
        <d:propstat><d:prop><d:resourcetype/><d:getetag>&quot;v1&quot;</d:getetag>
        <d:getcontentlength>32</d:getcontentlength><oc:permissions>R</oc:permissions>
        </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
      </d:multistatus>`, { status: 207 });
    }
    expect(path).toBe("file.txt");
    expect((init?.headers as Record<string, string>)["If-Match"]).toBe('"v1"');
    return new Response(`aislamiento remotefolder${folder}`);
  }));
  [pa, pb] = await Promise.all(["A", "B"].map(async name =>
    (await t.db.insert(t.provincesTable).values({ name }).returning())[0].id));
  const { getActiveFamily } = await import("../src/lib/settings");
  const family = await getActiveFamily();
  [ca, cb] = await Promise.all([pa, pb].map(async provinceId =>
    (await t.db.insert(t.centersTable).values({ name: `Center ${provinceId}`, provinceId, families: [family] }).returning())[0].id));
  [a, b] = await Promise.all([ca, cb].map(async (centerId, i) =>
    (await t.db.insert(t.usersTable).values({
      name: `User ${i}`, email: `isolation${i}@example.test`, passwordHash: "not-used",
      role: "teacher", centerId, provinceId: i ? pb : pa,
    }).returning())[0]));
  [ma, mb] = await Promise.all([ca, cb].map(async centerId =>
    (await t.db.insert(t.modulesTable).values({ name: `Module ${centerId}`, centerId }).returning())[0].id));
  await t.db.insert(t.moduleMembershipsTable).values([
    { moduleId: ma, userId: a.id }, { moduleId: mb, userId: b.id },
  ]);
});

async function keys(userId: number) {
  return (await t.db.select().from(t.aiKnowledgeEntriesTable)
    .where(eq(t.aiKnowledgeEntriesTable.userId, userId))).map(row => row.sourceKey).sort();
}
async function drain() {
  for (let i = 0; i < 50; i++) if (!await ai.processOneAiKnowledgeJob()) return;
  throw new Error("Knowledge worker failed to drain");
}
async function context(userId: number) {
  return (await ai.getAiKnowledgeContext(userId, "aislamiento")).context;
}
async function moduleFolder(moduleId: number, id: number) {
  const [module] = await t.db.select().from(t.modulesTable).where(eq(t.modulesTable.id, moduleId));
  folders.push({ id, mount_point: nc.moduleFolderName({ moduleId, name: module.name, code: module.code }),
    groups: { [nc.moduleGroupId(moduleId)]: 31 } });
}
async function makeWiki(moduleId: number, owner: number, label: string) {
  const [page] = await t.db.insert(t.wikiPagesTable).values({
    moduleId, title: label, content: `aislamiento ${label}`, createdBy: owner, updatedBy: owner,
  }).returning();
  const [file] = await t.db.insert(t.wikiAttachmentsTable).values({
    pageId: page.id, fileName: `${label}.txt`, objectPath: `/objects/uploads/${label}`,
    size: 20, contentType: "text/plain", uploadedBy: owner, indexedText: `aislamiento adjunto${label}`,
  }).returning();
  return [`wiki:${page.id}`, `wiki-file:${file.id}`];
}

describe("AI source isolation on disposable PostgreSQL", () => {
  it("isolates both users across wiki, attachments, submissions, resources, chats, minutes and Nextcloud", async () => {
    const expected: string[][] = [[], []];
    for (const [i, user, moduleId, centerId, provinceId] of [
      [0, a, ma, ca, pa], [1, b, mb, cb, pb],
    ] as const) {
      const label = i ? "privadobeta" : "privadoalfa";
      expected[i].push(...await makeWiki(moduleId, user.id, label));
      const [resource] = await t.db.insert(t.resourcesTable).values({
        title: label, description: `aislamiento ${label}`, type: "document", centerId,
      }).returning();
      const [form] = await t.db.insert(t.documentFormsTable).values({
        title: label, audienceType: "center", audienceIds: [centerId],
      }).returning();
      const [field] = await t.db.insert(t.documentFormFieldsTable).values({
        formId: form.id, label, type: "file",
      }).returning();
      const [submission] = await t.db.insert(t.documentSubmissionsTable).values({ formId: form.id, userId: user.id }).returning();
      const [value] = await t.db.insert(t.documentSubmissionValuesTable).values({
        submissionId: submission.id, fieldId: field.id, fileName: `${label}.txt`, objectPath: `/objects/uploads/${label}`,
      }).returning();
      const [group] = await t.db.insert(t.chatGroupsTable).values({ name: label }).returning();
      await t.db.insert(t.chatGroupMembersTable).values({ groupId: group.id, userId: user.id });
      const [message] = await t.db.insert(t.messagesTable).values({ groupId: group.id, senderId: user.id, content: `aislamiento ${label}` }).returning();
      const [event] = await t.db.insert(t.eventsTable).values({ name: label, type: "jornada", provinceId }).returning();
      await t.db.insert(t.meetingMinutesTable).values({ eventId: event.id, enabled: true,
        publishedText: `aislamiento ${label}`, draftText: `aislamiento borrador${label}` });
      await moduleFolder(moduleId, 101 + i);
      expected[i].push(`resource:${resource.id}`, `submission:${submission.id}`, `submission-value:${value.id}`,
        `chat:${message.id}`, `minutes-published:${event.id}`);
    }
    await ai.synchronizeAiKnowledge(a.id);
    await ai.synchronizeAiKnowledge(b.id);
    await drain();
    for (const [i, user] of [a, b].entries()) {
      const indexed = await keys(user.id);
      expect(indexed.filter(k => !k.startsWith("nextcloud:"))).toEqual(expected[i].sort());
      expect(indexed.filter(k => k.startsWith("nextcloud:"))).toHaveLength(1);
      const text = await context(user.id);
      expect(text).toContain(i ? "privadobeta" : "privadoalfa");
      expect(text).toContain(`remotefolder${101 + i}`);
      expect(text).not.toContain(i ? "privadoalfa" : "privadobeta");
      expect(text).not.toContain(`remotefolder${102 - i}`);
      expect(text).not.toContain("borrador");
    }
  });

  it("purges module wiki/files and remote files after membership removal, including teaching assignments", async () => {
    await makeWiki(ma, a.id, "revocarmodulo");
    await moduleFolder(ma, 101);
    const { getActiveAcademicYear } = await import("../src/lib/settings");
    await t.db.insert(t.teachingAssignmentsTable).values({
      teacherId: a.id, centerId: ca, moduleId: ma, schoolYear: await getActiveAcademicYear() ?? "2026-2027",
    });
    await ai.synchronizeAiKnowledge(a.id); await drain();
    const original = await keys(a.id);
    expect(original).toHaveLength(3);
    await t.db.update(t.moduleMembershipsTable).set({ deletedAt: new Date() }).where(eq(t.moduleMembershipsTable.userId, a.id));
    await ai.synchronizeAiKnowledge(a.id);
    expect(await keys(a.id)).toEqual(original); // teaching still grants access
    await t.db.update(t.teachingAssignmentsTable).set({ deletedAt: new Date() }).where(eq(t.teachingAssignmentsTable.teacherId, a.id));
    expect(await context(a.id)).not.toContain("revocarmodulo");
    expect(await keys(a.id)).toEqual([]);
    // The other user's own scope is unchanged.
    expect((await ai.synchronizeAiKnowledge(b.id)).status).toBe("ready");
  });

  it("revokes center and province materials on transfer and preserves the other user's entries", async () => {
    const [resource] = await t.db.insert(t.resourcesTable).values({ title: "aislamiento centroanterior", type: "document", centerId: ca }).returning();
    await makeWiki(ma, a.id, "modulocentroanterior");
    await ai.synchronizeAiKnowledge(a.id);
    expect(await keys(a.id)).toContain(`resource:${resource.id}`);
    await t.db.update(t.usersTable).set({ centerId: cb, provinceId: pb }).where(eq(t.usersTable.id, a.id));
    expect(await context(a.id)).not.toContain("centroanterior");
    expect(await keys(a.id)).toEqual([]);
    await t.db.update(t.usersTable).set({ role: "coordinator", centerId: null, provinceId: pa }).where(eq(t.usersTable.id, a.id));
    const [event] = await t.db.insert(t.eventsTable).values({ name: "Acta", type: "jornada", provinceId: pa }).returning();
    await t.db.insert(t.meetingMinutesTable).values({ eventId: event.id, enabled: true, publishedText: "aislamiento actaanterior" });
    const [evidence] = await t.db.insert(t.meetingMinutesSourcesTable).values({
      eventId: event.id, objectPath: "/objects/uploads/evidence", fileName: "evidence.txt",
      contentType: "text/plain", size: 20, status: "ready", extractedText: "aislamiento evidenciaanterior",
    }).returning();
    await makeWiki(mb, b.id, "betaconservado");
    await ai.synchronizeAiKnowledge(a.id); await ai.synchronizeAiKnowledge(b.id);
    const other = await keys(b.id);
    expect(await keys(a.id)).toEqual(expect.arrayContaining([`resource:${resource.id}`, `minutes-published:${event.id}`, `minutes-source:${evidence.id}`]));
    await t.db.update(t.usersTable).set({ provinceId: pb }).where(eq(t.usersTable.id, a.id));
    const text = await context(a.id);
    expect(text).not.toContain("anterior");
    expect((await keys(a.id)).some(k => [`resource:${resource.id}`, `minutes-published:${event.id}`, `minutes-source:${evidence.id}`].includes(k))).toBe(false);
    expect(await keys(b.id)).toEqual(other);
  });

  it("removes submissions after loss of management scope or a change of submission owner", async () => {
    await t.db.update(t.usersTable).set({ role: "coordinator", provinceId: pa }).where(eq(t.usersTable.id, a.id));
    const [form] = await t.db.insert(t.documentFormsTable).values({ title: "Entrega", audienceType: "center", audienceIds: [ca] }).returning();
    const [field] = await t.db.insert(t.documentFormFieldsTable).values({ formId: form.id, label: "Texto", type: "text" }).returning();
    const [submission] = await t.db.insert(t.documentSubmissionsTable).values({ formId: form.id, userId: b.id }).returning();
    const [value] = await t.db.insert(t.documentSubmissionValuesTable).values({ submissionId: submission.id, fieldId: field.id, value: "aislamiento entregaprivada" }).returning();
    await ai.synchronizeAiKnowledge(a.id);
    expect(await keys(a.id)).toContain(`submission-value:${value.id}`);
    await t.db.update(t.usersTable).set({ provinceId: pb }).where(eq(t.usersTable.id, a.id));
    expect(await context(a.id)).not.toContain("entregaprivada");
    expect(await keys(a.id)).toEqual([]);
    await ai.synchronizeAiKnowledge(b.id);
    expect(await context(b.id)).toContain("entregaprivada"); // still its author
    await t.db.update(t.documentSubmissionsTable).set({ userId: a.id }).where(eq(t.documentSubmissionsTable.id, submission.id));
    expect(await context(b.id)).not.toContain("entregaprivada");
    expect(await keys(b.id)).toEqual([]);
  });

  it("revokes an independent space and group messages, even messages authored by the removed member", async () => {
    const [space] = await t.db.insert(t.collaborativeSpacesTable).values({ name: "Privado" }).returning();
    await t.db.insert(t.collaborativeSpaceMembersTable).values({ spaceId: space.id, userId: a.id });
    folders.push({ id: 201, mount_point: nc.independentSpaceFolderName(space.id),
      groups: { [nc.independentSpaceGroupId(space.id)]: 31 } });
    const [group] = await t.db.insert(t.chatGroupsTable).values({ name: "Grupo" }).returning();
    await t.db.insert(t.chatGroupMembersTable).values({ groupId: group.id, userId: a.id });
    await t.db.insert(t.messagesTable).values([
      { groupId: group.id, senderId: a.id, content: "aislamiento autorretirado" },
      { groupId: group.id, senderId: b.id, content: "aislamiento gruporetirado" },
      { senderId: b.id, recipientId: a.id, content: "aislamiento directoconservado" },
    ]);
    await ai.synchronizeAiKnowledge(a.id); await drain();
    expect(await keys(a.id)).toHaveLength(4);
    await t.db.delete(t.collaborativeSpaceMembersTable).where(eq(t.collaborativeSpaceMembersTable.userId, a.id));
    await t.db.delete(t.chatGroupMembersTable).where(eq(t.chatGroupMembersTable.userId, a.id));
    requests.length = 0;
    const text = await context(a.id);
    expect(text).toContain("directoconservado");
    expect(text).not.toMatch(/autorretirado|gruporetirado|remotefolder201/);
    expect(await keys(a.id)).toHaveLength(1);
    expect(requests.some(r => r.includes("/groupfolders/201/"))).toBe(false);
  });

  it("isolates Gmail text and attachments by both case and message owner, including superadmins", async () => {
    await t.db.update(t.usersTable).set({ role: "superadmin" }).where(eq(t.usersTable.id, a.id));
    await t.db.update(t.usersTable).set({ role: "coordinator" }).where(eq(t.usersTable.id, b.id));
    const mailKeys: string[][] = [[], []];
    for (const [i, user] of [a, b].entries()) {
      await t.db.insert(t.coordinatorMailAccountsTable).values({ userId: user.id, lastSyncAt: new Date() });
      const [c] = await t.db.insert(t.coordinatorMailCasesTable).values({ ownerId: user.id, title: `Case ${i}` }).returning();
      const [message] = await t.db.insert(t.coordinatorMailMessagesTable).values({
        ownerId: user.id, caseId: c.id, gmailMessageId: `message${i}`, senderEmail: "sender@example.test",
        subject: `buzon${i}`, bodyText: `aislamiento buzon${i}`, receivedAt: new Date(),
      }).returning();
      const [attachment] = await t.db.insert(t.coordinatorMailAttachmentsTable).values({
        messageId: message.id, fileName: `adjuntobuzon${i}.txt`, objectPath: `/objects/uploads/adjuntobuzon${i}`,
        providerAttachmentId: `attachment${i}`, contentType: "text/plain", size: 20, status: "ready",
      }).returning();
      mailKeys[i] = [`mail:${message.id}`, `mail-attachment:${attachment.id}`].sort();
    }
    await ai.synchronizeAiKnowledge(a.id); await ai.synchronizeAiKnowledge(b.id); await drain();
    expect(await keys(a.id)).toEqual(mailKeys[0]);
    expect(await keys(b.id)).toEqual(mailKeys[1]);
    expect(await context(a.id)).not.toContain("buzon1");
    expect(await context(b.id)).not.toContain("buzon0");
    // A mismatched legacy record must not leak either its body or its file.
    const [caseA] = await t.db.select().from(t.coordinatorMailCasesTable).where(eq(t.coordinatorMailCasesTable.ownerId, a.id));
    await t.db.update(t.coordinatorMailMessagesTable).set({ ownerId: b.id }).where(eq(t.coordinatorMailMessagesTable.caseId, caseA.id));
    expect(await context(a.id)).not.toContain("buzon0");
    expect(await keys(a.id)).toEqual([]);
    // Moving the case alone cannot expose messages still owned by someone else.
    await t.db.update(t.coordinatorMailCasesTable).set({ ownerId: a.id }).where(eq(t.coordinatorMailCasesTable.ownerId, b.id));
    expect(await context(a.id)).not.toContain("buzon1");
    expect(await context(b.id)).not.toContain("buzon1");
    expect(await keys(b.id)).toEqual([]);
  });

  it("purges Gmail when a coordinator loses the mail role or disconnects the account", async () => {
    await t.db.update(t.usersTable).set({ role: "coordinator" }).where(eq(t.usersTable.id, a.id));
    await t.db.insert(t.coordinatorMailAccountsTable).values({ userId: a.id, lastSyncAt: new Date() });
    const [c] = await t.db.insert(t.coordinatorMailCasesTable).values({ ownerId: a.id, title: "Correo" }).returning();
    await t.db.insert(t.coordinatorMailMessagesTable).values({
      ownerId: a.id, caseId: c.id, gmailMessageId: "revoked-role", senderEmail: "sender@example.test",
      subject: "Correo", bodyText: "aislamiento correorevocado", receivedAt: new Date(),
    });
    await ai.synchronizeAiKnowledge(a.id);
    expect(await context(a.id)).toContain("correorevocado");
    await t.db.update(t.usersTable).set({ role: "teacher" }).where(eq(t.usersTable.id, a.id));
    expect(await context(a.id)).not.toContain("correorevocado");
    expect(await keys(a.id)).toEqual([]);
    await t.db.update(t.usersTable).set({ role: "coordinator" }).where(eq(t.usersTable.id, a.id));
    expect(await context(a.id)).toContain("correorevocado");
    await t.db.delete(t.coordinatorMailAccountsTable).where(eq(t.coordinatorMailAccountsTable.userId, a.id));
    expect(await context(a.id)).not.toContain("correorevocado");
    expect(await keys(a.id)).toEqual([]);
  });

  it("excludes foreign mail from the actual drafting request and rejects foreign-only cases at preflight and in the worker", async () => {
    const { default: express } = await import("express");
    const { default: request } = await import("supertest");
    const { default: router } = await import("../src/routes/coordinatorMail");
    const { signToken } = await import("../src/lib/auth");
    const { processOneCoordinatorMailDraft } = await import("../src/lib/coordinatorMailWorker");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    await t.db.update(t.usersTable).set({ role: "coordinator" }).where(eq(t.usersTable.id, a.id));
    const token = signToken({ sub: a.id, role: "coordinator", tokenVersion: a.tokenVersion, sessionNonce: a.sessionNonce });
    const [c] = await t.db.insert(t.coordinatorMailCasesTable).values({ ownerId: a.id, title: "aislamiento respuesta" }).returning();
    const [owned] = await t.db.insert(t.coordinatorMailMessagesTable).values({
      ownerId: a.id, caseId: c.id, gmailMessageId: "owned-drafting", senderEmail: "owned@example.test",
      subject: "Propio", bodyText: "aislamiento cuerpopropiodraft", receivedAt: new Date(),
    }).returning();
    await t.db.insert(t.coordinatorMailMessagesTable).values({
      ownerId: b.id, caseId: c.id, gmailMessageId: "foreign-drafting", senderEmail: "foreign@example.test",
      subject: "Ajeno", bodyText: "aislamiento secretoajenodraft", receivedAt: new Date(),
    });
    const path = `/api/coordinator-mail/cases/${c.id}/ai-draft`;
    const queued = await request(app).post(path).set("Authorization", `Bearer ${token}`)
      .send({ revision: 1, consent: true, instructions: "Redacta una respuesta." });
    expect(queued.status).toBe(202);
    expect(await processOneCoordinatorMailDraft()).toBe(true);
    expect(draftCompletion).toHaveBeenCalledTimes(1);
    const sentToModel = JSON.stringify(draftCompletion.mock.calls[0][0]);
    expect(sentToModel).toContain("cuerpopropiodraft");
    expect(sentToModel).not.toContain("secretoajenodraft");
    expect(sentToModel).not.toContain("foreign@example.test");
    const [finished] = await t.db.select().from(t.coordinatorMailCasesTable).where(eq(t.coordinatorMailCasesTable.id, c.id));
    expect(finished.aiStatus).toBe("idle");
    expect(finished.draftBody).toBe("Borrador seguro de prueba");
    // No remaining owned mail: preflight must reject without queuing.
    await t.db.delete(t.coordinatorMailMessagesTable).where(eq(t.coordinatorMailMessagesTable.id, owned.id));
    const rejected = await request(app).post(path).set("Authorization", `Bearer ${token}`)
      .send({ revision: finished.revision, consent: true, instructions: "" });
    expect(rejected.status).toBe(400);
    expect(draftCompletion).toHaveBeenCalledTimes(1);
    // Also guard already queued legacy jobs, independently of route validation.
    await t.db.update(t.coordinatorMailCasesTable).set({
      aiStatus: "queued", aiConsentAt: new Date(), aiRequestedBy: a.id, aiRevision: finished.revision,
    }).where(eq(t.coordinatorMailCasesTable.id, c.id));
    expect(await processOneCoordinatorMailDraft()).toBe(true);
    expect(draftCompletion).toHaveBeenCalledTimes(1);
    const [blocked] = await t.db.select().from(t.coordinatorMailCasesTable).where(eq(t.coordinatorMailCasesTable.id, c.id));
    expect(blocked.aiStatus).toBe("error");
  });

  it("purges Nextcloud files if the managed group loses read permission", async () => {
    await moduleFolder(ma, 101);
    await ai.synchronizeAiKnowledge(a.id); await drain();
    expect(await context(a.id)).toContain("remotefolder101");
    folders[0].groups[nc.moduleGroupId(ma)] = 2; // write without read
    requests.length = 0;
    expect(await context(a.id)).not.toContain("remotefolder101");
    expect(await keys(a.id)).toEqual([]);
    expect(requests.some(r => r.includes("/dav/"))).toBe(false);
  });

  it.each([true, 1, "1"])("omits and purges Nextcloud advanced ACL files (%s) without reading them", async acl => {
    await moduleFolder(ma, 101);
    const [space] = await t.db.insert(t.collaborativeSpacesTable).values({ name: "ACL space" }).returning();
    await t.db.insert(t.collaborativeSpaceMembersTable).values({ spaceId: space.id, userId: a.id });
    folders.push({ id: 201, mount_point: nc.independentSpaceFolderName(space.id),
      groups: { [nc.independentSpaceGroupId(space.id)]: 31 } });
    await ai.synchronizeAiKnowledge(a.id); await drain();
    expect(await keys(a.id)).toHaveLength(2);
    folders[0].acl = acl;
    folders[1].advanced_permissions = acl;
    requests.length = 0;
    const status = await ai.synchronizeAiKnowledge(a.id);
    expect(status.warnings.filter(w => w.includes("permisos avanzados"))).toHaveLength(2);
    expect(await keys(a.id)).toEqual([]);
    expect(await context(a.id)).not.toContain("remotefolder");
    expect(requests.some(r => r.includes("/dav/"))).toBe(false);
  });

  it("fails closed on remote outage, failed authorization scans and inactive accounts", async () => {
    await makeWiki(ma, a.id, "contenidoprevio");
    await moduleFolder(ma, 101);
    await ai.synchronizeAiKnowledge(a.id); await drain();
    expect(await context(a.id)).toContain("remotefolder101");
    remoteDown = true;
    expect((await ai.synchronizeAiKnowledge(a.id)).warnings.join(" ")).toContain("Nextcloud");
    expect((await keys(a.id)).some(k => k.startsWith("nextcloud:"))).toBe(false);
    // A SQL collection error must reject, never serve the existing ready text.
    await t.db.execute(sql`ALTER TABLE wiki_pages RENAME TO hidden_wiki_pages`);
    try {
      await expect(context(a.id)).rejects.toThrow("No se pudo comprobar el acceso");
    } finally {
      await t.db.execute(sql`ALTER TABLE hidden_wiki_pages RENAME TO wiki_pages`);
    }
    await t.db.update(t.usersTable).set({ status: "inactive" }).where(eq(t.usersTable.id, a.id));
    expect(await context(a.id)).toBe("");
    expect(await keys(a.id)).toEqual([]);
    expect(await ai.processOneAiKnowledgeJob()).toBe(false);
  });
});
