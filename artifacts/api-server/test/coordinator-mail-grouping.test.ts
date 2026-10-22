import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import {
  coordinatorMailAttachmentsTable,
  coordinatorMailCaseNotesTable,
  coordinatorMailCasesTable,
  coordinatorMailMessagesTable,
  db,
} from "@workspace/db";
import app from "../src/app";
import { authHeader, cleanup, createUser } from "./helpers";

type SeededUser = Awaited<ReturnType<typeof createUser>>;
type MailCase = typeof coordinatorMailCasesTable.$inferSelect;
let owner: SeededUser;
let otherOwner: SeededUser;
let nonCoordinator: SeededUser;
let cases: MailCase[];
let privateCaseId: number;

const call = (method: "get" | "post" | "delete", path: string, user = owner) =>
  request(app)[method](`/api${path}`).set(authHeader(user.token));
const casePath = (id: number) => `/coordinator-mail/cases/${id}`;

beforeAll(async () => {
  owner = await createUser({ role: "coordinator" });
  otherOwner = await createUser({ role: "coordinator" });
  nonCoordinator = await createUser({ role: "teacher", incompleteProfile: true });
  const ownerCases = await db.insert(coordinatorMailCasesTable).values(
    ["A", "B", "C", "D"].map((label) => ({
      ownerId: owner.user.id,
      gmailThreadId: null,
      title: `Caso de prueba ${label}`,
      draftTo: `${label.toLowerCase()}@example.test`,
      draftSubject: `Borrador ${label}`,
      draftBody: `Texto privado ${label}`,
    })),
  ).returning();
  cases = ownerCases;
  const [foreign] = await db.insert(coordinatorMailCasesTable).values({
    ownerId: otherOwner.user.id,
    title: "Caso privado ajeno",
    draftBody: "No debe aparecer",
  }).returning();
  privateCaseId = foreign!.id;

  const messages = await db.insert(coordinatorMailMessagesTable).values(ownerCases.map((mailCase, index) => ({
    ownerId: owner.user.id,
    caseId: mailCase.id,
    gmailMessageId: `grouping-${owner.user.id}-${index}`,
    direction: "received",
    senderEmail: `sender${index}@example.test`,
    subject: `Mensaje ${String.fromCharCode(65 + index)}`,
    bodyText: `contenido-buscable-${String.fromCharCode(65 + index)}`,
    receivedAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
  }))).returning();
  await db.insert(coordinatorMailCaseNotesTable).values([
    { caseId: ownerCases[0]!.id, createdBy: owner.user.id, kind: "note", content: "Nota original A", createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 30)) },
    { caseId: ownerCases[1]!.id, createdBy: owner.user.id, kind: "note", content: "Nota original B", createdAt: new Date(Date.UTC(2026, 0, 1, 0, 1, 30)) },
  ]);
  await db.insert(coordinatorMailAttachmentsTable).values({
    messageId: messages[1]!.id,
    providerAttachmentId: "attachment-b",
    fileName: "adjunto-b.pdf",
    contentType: "application/pdf",
    size: 123,
    status: "queued",
  });
});

afterAll(async () => {
  await cleanup();
});

describe("Agrupación privada de casos de correo", () => {
  it("exige coordinación y no permite vincular casos de otro buzón", async () => {
    const [first, second] = cases!;
    expect((await request(app).post(`/api${casePath(first!.id)}/links`).send({ targetCaseId: second!.id })).status).toBe(401);
    expect((await call("post", `${casePath(first!.id)}/links`, nonCoordinator).send({ targetCaseId: second!.id })).status).toBe(403);
    expect((await call("post", `${casePath(first!.id)}/links`).send({ targetCaseId: privateCaseId })).status).toBe(404);
    expect((await call("get", casePath(privateCaseId))).status).toBe(404);
  });

  it("reúne historiales con procedencia y orden, admite grupos enlazados y los separa sin mover datos", async () => {
    const [a, b, c, d] = cases!;
    expect((await call("post", `${casePath(a!.id)}/links`).send({ targetCaseId: b!.id })).status).toBe(200);
    expect((await call("post", `${casePath(c!.id)}/links`).send({ targetCaseId: d!.id })).status).toBe(200);
    const merged = await call("post", `${casePath(a!.id)}/links`).send({ targetCaseId: c!.id });
    expect(merged.status).toBe(200);
    expect(merged.body.linkedCases).toHaveLength(4);
    expect(merged.body.messages.total).toBe(4);
    expect(merged.body.messages.items.map((message: { caseTitle: string }) => message.caseTitle)).toEqual([
      "Caso de prueba D", "Caso de prueba C", "Caso de prueba B", "Caso de prueba A",
    ]);
    expect(merged.body.messages.items.find((message: { caseId: number }) => message.caseId === b!.id).attachments)
      .toMatchObject([{ fileName: "adjunto-b.pdf", status: "queued" }]);
    expect(merged.body.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: a!.id, caseTitle: "Caso de prueba A", content: "Nota original A" }),
      expect.objectContaining({ caseId: b!.id, caseTitle: "Caso de prueba B", content: "Nota original B" }),
    ]));

    const workspace = await call("get", "/coordinator-mail/workspace");
    expect(workspace.status).toBe(200);
    expect(workspace.body.total).toBe(1);
    expect(workspace.body.items[0]).toMatchObject({ id: a!.id, linkedCaseCount: 4, messageCount: 4, attachmentCount: 1 });
    const search = await call("get", "/coordinator-mail/workspace?search=contenido-buscable-D");
    expect(search.body.items).toHaveLength(1);
    expect(search.body.items[0].id).toBe(a!.id);

    const [detailA, detailD] = await Promise.all([
      call("get", casePath(a!.id)),
      call("get", casePath(d!.id)),
    ]);
    expect(detailA.body.draftBody).toBe("Texto privado A");
    expect(detailD.body.draftBody).toBe("Texto privado D");
    expect((await call("post", `${casePath(a!.id)}/links`).send({ targetCaseId: b!.id })).status).toBe(409);

    expect((await call("delete", `${casePath(a!.id)}/links/${d!.id}`)).body.linkedCases).toHaveLength(3);
    expect((await call("get", casePath(d!.id))).body.messages.total).toBe(1);
    expect((await call("delete", `${casePath(a!.id)}/links/${b!.id}`)).body.linkedCases).toHaveLength(2);
    expect((await call("delete", `${casePath(a!.id)}/links/${c!.id}`)).body.linkedCases).toHaveLength(1);
    const separatedWorkspace = await call("get", "/coordinator-mail/workspace");
    expect(separatedWorkspace.body.total).toBe(4);
    expect(separatedWorkspace.body.items.reduce((sum: number, item: { messageCount: number }) => sum + item.messageCount, 0)).toBe(4);
  });
});
