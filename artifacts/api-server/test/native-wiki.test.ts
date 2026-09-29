import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import JSZip from "jszip";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  moduleMembershipsTable,
  modulesTable,
  wikiAttachmentsTable,
  wikiModuleEditorsTable,
  wikiPagesTable,
  wikiUploadIntentsTable,
} from "@workspace/db";
import app from "../src/app";
import {
  addMembership,
  authHeader,
  cleanup,
  createModule as createBaseModule,
  createUser,
} from "./helpers";
import { extractText, indexWikiAttachment } from "../src/lib/wikiIndexing";
import { ObjectStorageService } from "../src/lib/objectStorage";

const UNIQUE = `wikiregress${Date.now()}${Math.random().toString(36).slice(2, 9)}`;
const fixture = {
  userIds: [] as number[],
  moduleIds: [] as number[],
  pageIds: [] as number[],
  attachmentIds: [] as number[],
};

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (fixture.attachmentIds.length > 0) {
    await db
      .delete(wikiAttachmentsTable)
      .where(inArray(wikiAttachmentsTable.id, fixture.attachmentIds));
  }
  if (fixture.moduleIds.length > 0) {
    await db
      .delete(wikiModuleEditorsTable)
      .where(inArray(wikiModuleEditorsTable.moduleId, fixture.moduleIds));
  }
  if (fixture.userIds.length > 0) {
    await db
      .delete(wikiUploadIntentsTable)
      .where(inArray(wikiUploadIntentsTable.userId, fixture.userIds));
  }
  if (fixture.pageIds.length > 0) {
    await db
      .delete(wikiPagesTable)
      .where(inArray(wikiPagesTable.id, fixture.pageIds));
  }
  await cleanup();
});

async function makeUser(options: Parameters<typeof createUser>[0] = {}) {
  const created = await createUser(options);
  fixture.userIds.push(created.user.id);
  return created;
}

async function makeModule() {
  const id = await createBaseModule({ name: `${UNIQUE} module` });
  fixture.moduleIds.push(id);
  return id;
}

async function makePage(options: {
  userId: number;
  moduleId?: number | null;
  title?: string;
  content?: string;
  tags?: string[];
}) {
  const [page] = await db
    .insert(wikiPagesTable)
    .values({
      moduleId: options.moduleId ?? null,
      parentId: null,
      title: options.title ?? `${UNIQUE} page`,
      content: options.content ?? "",
      tags: options.tags ?? [],
      createdBy: options.userId,
      updatedBy: options.userId,
    })
    .returning({ id: wikiPagesTable.id });
  fixture.pageIds.push(page!.id);
  return page!.id;
}

async function makeAttachment(options: {
  pageId: number;
  userId: number;
  fileName: string;
  objectPath?: string;
  indexedText?: string;
  indexStatus?: string;
  size?: number;
}) {
  const [attachment] = await db
    .insert(wikiAttachmentsTable)
    .values({
      pageId: options.pageId,
      fileName: options.fileName,
      objectPath:
        options.objectPath ??
        `/objects/uploads/${UNIQUE}${fixture.attachmentIds.length}attachment`,
      contentType: "application/octet-stream",
      size: options.size ?? 1,
      indexedText: options.indexedText ?? "",
      indexStatus: options.indexStatus ?? "indexed",
      uploadedBy: options.userId,
    })
    .returning({ id: wikiAttachmentsTable.id });
  fixture.attachmentIds.push(attachment!.id);
  return attachment!.id;
}

function temporaryStorageError(): Error & { code: number } {
  const error = new Error("Temporary object storage outage") as Error & {
    code: number;
  };
  error.code = 503;
  return error;
}

describe("native wiki authenticated reads and search", () => {
  it("allows authenticated users to read global and module pages, and rejects anonymous requests", async () => {
    const reader = await makeUser();
    const globalPageId = await makePage({
      userId: reader.user.id,
      title: `${UNIQUE} global`,
      content: `${UNIQUE} ${UNIQUE}pagebodyneedle`,
    });
    const moduleId = await makeModule();
    const modulePageId = await makePage({
      userId: reader.user.id,
      moduleId,
      title: `${UNIQUE} module page`,
      content: "Module wiki content",
    });

    const list = await request(app)
      .get(`/api/wiki/pages?q=${UNIQUE}pagebodyneedle`)
      .set(authHeader(reader.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((item: { id: number }) => item.id)).toContain(
      globalPageId,
    );

    const globalRead = await request(app)
      .get(`/api/wiki/pages/${globalPageId}`)
      .set(authHeader(reader.token));
    expect(globalRead.status).toBe(200);
    expect(globalRead.body.content).toContain("pagebodyneedle");

    const moduleRead = await request(app)
      .get(`/api/wiki/pages/${modulePageId}`)
      .set(authHeader(reader.token));
    expect(moduleRead.status).toBe(200);
    expect(moduleRead.body.moduleId).toBe(moduleId);

    expect((await request(app).get("/api/wiki/pages")).status).toBe(401);
    expect(
      (await request(app).get(`/api/wiki/pages/${globalPageId}`)).status,
    ).toBe(401);
  });

  it("searches page text, exact tags, and attachment file names", async () => {
    const reader = await makeUser();
    const exactTag = `exacttag${UNIQUE}`;
    const pageId = await makePage({
      userId: reader.user.id,
      title: `${UNIQUE} searchable page`,
      content: `${UNIQUE} ${UNIQUE}pagecontentneedle`,
      tags: [exactTag],
    });
    const similarTagPageId = await makePage({
      userId: reader.user.id,
      title: `${UNIQUE} similar tag page`,
      tags: [`${exactTag}extra`],
    });
    await makeAttachment({
      pageId,
      userId: reader.user.id,
      fileName: `filemarker${UNIQUE}.txt`,
    });

    const textSearch = await request(app)
      .get(`/api/wiki/pages?q=${UNIQUE}pagecontentneedle`)
      .set(authHeader(reader.token));
    expect(
      textSearch.body.items.map((item: { id: number }) => item.id),
    ).toContain(pageId);

    const exactTagSearch = await request(app)
      .get(`/api/wiki/pages?q=${exactTag}`)
      .set(authHeader(reader.token));
    const exactTagIds = exactTagSearch.body.items.map(
      (item: { id: number }) => item.id,
    );
    expect(exactTagIds).toContain(pageId);
    expect(exactTagIds).not.toContain(similarTagPageId);

    const tagFilter = await request(app)
      .get(`/api/wiki/pages?tag=${exactTag}`)
      .set(authHeader(reader.token));
    expect(tagFilter.body.items.map((item: { id: number }) => item.id)).toEqual(
      [pageId],
    );

    const attachmentSearch = await request(app)
      .get(`/api/wiki/pages?q=filemarker${UNIQUE}`)
      .set(authHeader(reader.token));
    expect(
      attachmentSearch.body.items.map((item: { id: number }) => item.id),
    ).toContain(pageId);
  });
});

describe("native wiki edit grants", () => {
  it("restricts general-page creation and edits to superadmins", async () => {
    const teacher = await makeUser();
    const admin = await makeUser({ role: "superadmin" });
    const body = {
      moduleId: null,
      parentId: null,
      title: `${UNIQUE} superadmin-only`,
      content: "Before",
      tags: [],
    };

    const deniedCreate = await request(app)
      .post("/api/wiki/pages")
      .set(authHeader(teacher.token))
      .send(body);
    expect(deniedCreate.status).toBe(403);

    const created = await request(app)
      .post("/api/wiki/pages")
      .set(authHeader(admin.token))
      .send(body);
    expect(created.status).toBe(201);
    fixture.pageIds.push(created.body.id);

    const deniedEdit = await request(app)
      .patch(`/api/wiki/pages/${created.body.id}`)
      .set(authHeader(teacher.token))
      .send({ content: "Unauthorized change" });
    expect(deniedEdit.status).toBe(403);

    const permittedEdit = await request(app)
      .patch(`/api/wiki/pages/${created.body.id}`)
      .set(authHeader(admin.token))
      .send({ content: "After" });
    expect(permittedEdit.status).toBe(200);
    expect(permittedEdit.body.content).toBe("After");
  });

  it("requires an active module edit grant and limits coordinator management to active members", async () => {
    const moduleId = await makeModule();
    const coordinator = await makeUser();
    const editor = await makeUser();
    const outsider = await makeUser();
    const inactiveUser = await makeUser({ status: "inactive" });
    const departedMember = await makeUser();
    await addMembership(moduleId, coordinator.user.id, "coordinator");
    await addMembership(moduleId, editor.user.id, "member");
    await addMembership(moduleId, inactiveUser.user.id, "member");
    await addMembership(moduleId, departedMember.user.id, "member");
    await db
      .update(moduleMembershipsTable)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(moduleMembershipsTable.moduleId, moduleId),
          eq(moduleMembershipsTable.userId, departedMember.user.id),
        ),
      );

    const pageId = await makePage({
      userId: editor.user.id,
      moduleId,
      title: `${UNIQUE} grant-required`,
    });
    const denied = await request(app)
      .patch(`/api/wiki/pages/${pageId}`)
      .set(authHeader(editor.token))
      .send({ content: "No grant yet" });
    expect(denied.status).toBe(403);

    const editorList = await request(app)
      .get(`/api/wiki/modules/${moduleId}/editors`)
      .set(authHeader(coordinator.token));
    expect(editorList.status).toBe(200);
    expect(editorList.body.canManage).toBe(true);
    expect(
      new Set(
        editorList.body.candidates.map((item: { id: number }) => item.id),
      ),
    ).toEqual(new Set([coordinator.user.id, editor.user.id]));

    const withoutPermissions = (userId: number) => ({
      userId,
      directPermissions: {
        canUpload: false,
        canEdit: false,
        canDelete: false,
      },
      groupIds: [],
    });
    const withEditorGrant = [
      withoutPermissions(coordinator.user.id),
      {
        ...withoutPermissions(editor.user.id),
        directPermissions: {
          canUpload: false,
          canEdit: true,
          canDelete: false,
        },
      },
    ];
    const grant = await request(app)
      .put(`/api/wiki/modules/${moduleId}/editors`)
      .set(authHeader(coordinator.token))
      .send({ users: withEditorGrant });
    expect(grant.status).toBe(200);
    expect(
      grant.body.candidates.find(
        (candidate: { id: number }) => candidate.id === editor.user.id,
      ).directPermissions.canEdit,
    ).toBe(true);

    const permitted = await request(app)
      .patch(`/api/wiki/pages/${pageId}`)
      .set(authHeader(editor.token))
      .send({ content: "Granted change" });
    expect(permitted.status).toBe(200);
    expect(permitted.body.content).toBe("Granted change");

    const invalidGrant = await request(app)
      .put(`/api/wiki/modules/${moduleId}/editors`)
      .set(authHeader(coordinator.token))
      .send({
        users: [...withEditorGrant, withoutPermissions(outsider.user.id)],
      });
    expect(invalidGrant.status).toBe(400);

    const revoke = await request(app)
      .put(`/api/wiki/modules/${moduleId}/editors`)
      .set(authHeader(coordinator.token))
      .send({
        users: [
          withoutPermissions(coordinator.user.id),
          withoutPermissions(editor.user.id),
        ],
      });
    expect(revoke.status).toBe(200);
    const revokedEdit = await request(app)
      .patch(`/api/wiki/pages/${pageId}`)
      .set(authHeader(editor.token))
      .send({ content: "Grant was removed" });
    expect(revokedEdit.status).toBe(403);
  });
});

describe("native wiki private attachments", () => {
  it("binds upload intents to their requesting user and permits authenticated downloads", async () => {
    const uploader = await makeUser({ role: "superadmin" });
    const otherAdmin = await makeUser({ role: "superadmin" });
    const reader = await makeUser();
    const pageId = await makePage({ userId: uploader.user.id });
    const uploadId = `${UNIQUE}uploadidentifier123456`;
    const uploadURL = `http://localhost/api/storage/local-upload/uploads/${uploadId}?exp=9999999999999&sig=mock`;
    const uploadUrlSpy = vi
      .spyOn(ObjectStorageService.prototype, "getObjectEntityUploadURL")
      .mockResolvedValue(uploadURL);
    const objectLookupSpy = vi
      .spyOn(ObjectStorageService.prototype, "getObjectEntityFile")
      .mockResolvedValue({ kind: "local", absPath: "/tmp/wiki-test-object" });
    let storedBody = "size-mismatch";
    vi.spyOn(
      ObjectStorageService.prototype,
      "downloadObject",
    ).mockImplementation(async () => {
      const body = storedBody;
      return new Response(body, {
        headers: { "content-length": String(Buffer.byteLength(body)) },
      });
    });
    const aclSpy = vi
      .spyOn(ObjectStorageService.prototype, "trySetObjectEntityAclPolicy")
      .mockResolvedValue(`/objects/uploads/${uploadId}`);

    const intent = await request(app)
      .post("/api/wiki/uploads/request-url")
      .set(authHeader(uploader.token))
      .send({
        pageId,
        fileName: "guide.txt",
        contentType: "text/plain",
        size: 5,
      });
    expect(intent.status).toBe(200);
    expect(intent.body.objectPath).toBe(`/objects/uploads/${uploadId}`);
    expect(uploadUrlSpy).toHaveBeenCalledOnce();

    const attachmentInput = {
      fileName: "guide.txt",
      objectPath: intent.body.objectPath,
      contentType: "text/plain",
      size: 5,
    };
    const crossUserAttempt = await request(app)
      .post(`/api/wiki/pages/${pageId}/attachments`)
      .set(authHeader(otherAdmin.token))
      .send(attachmentInput);
    expect(crossUserAttempt.status).toBe(400);
    expect(objectLookupSpy).not.toHaveBeenCalled();

    const mismatchedFileAttempt = await request(app)
      .post(`/api/wiki/pages/${pageId}/attachments`)
      .set(authHeader(uploader.token))
      .send(attachmentInput);
    expect(mismatchedFileAttempt.status).toBe(400);
    expect(objectLookupSpy).toHaveBeenCalledOnce();
    const [unconsumedIntent] = await db
      .select()
      .from(wikiUploadIntentsTable)
      .where(eq(wikiUploadIntentsTable.objectPath, intent.body.objectPath));
    expect(unconsumedIntent!.consumedAt).toBeNull();

    storedBody = "hello";
    const attached = await request(app)
      .post(`/api/wiki/pages/${pageId}/attachments`)
      .set(authHeader(uploader.token))
      .send(attachmentInput);
    expect(attached.status).toBe(201);
    expect(attached.body.attachmentCount).toBe(1);
    const [savedAttachment] = await db
      .select()
      .from(wikiAttachmentsTable)
      .where(eq(wikiAttachmentsTable.pageId, pageId));
    fixture.attachmentIds.push(savedAttachment!.id);
    expect(savedAttachment!.uploadedBy).toBe(uploader.user.id);
    expect(aclSpy).toHaveBeenCalledWith(intent.body.objectPath, {
      owner: String(uploader.user.id),
      visibility: "private",
    });

    const replayedIntent = await request(app)
      .post(`/api/wiki/pages/${pageId}/attachments`)
      .set(authHeader(uploader.token))
      .send(attachmentInput);
    expect(replayedIntent.status).toBe(400);

    const [savedIntent] = await db
      .select()
      .from(wikiUploadIntentsTable)
      .where(eq(wikiUploadIntentsTable.objectPath, intent.body.objectPath));
    expect(savedIntent!.userId).toBe(uploader.user.id);
    expect(savedIntent!.consumedAt).not.toBeNull();

    expect(
      (
        await request(app).get(
          `/api/wiki/attachments/${savedAttachment!.id}/download`,
        )
      ).status,
    ).toBe(401);

    const download = await request(app)
      .get(`/api/wiki/attachments/${savedAttachment!.id}/download`)
      .set(authHeader(reader.token));
    expect(download.status).toBe(200);
    expect(download.body.toString("utf8")).toBe("hello");
    expect(download.headers["x-content-type-options"]).toBe("nosniff");
    expect(download.headers["content-disposition"]).toContain("guide.txt");
  });

  it("does not expose attachments from deleted pages or modules", async () => {
    const reader = await makeUser();
    const globalPageId = await makePage({
      userId: reader.user.id,
      title: `${UNIQUE} deleted-page`,
    });
    const globalAttachmentId = await makeAttachment({
      pageId: globalPageId,
      userId: reader.user.id,
      fileName: `${UNIQUE} deleted-page.txt`,
    });
    const moduleId = await makeModule();
    const modulePageId = await makePage({
      userId: reader.user.id,
      moduleId,
      title: `${UNIQUE} deleted-module`,
    });
    const moduleAttachmentId = await makeAttachment({
      pageId: modulePageId,
      userId: reader.user.id,
      fileName: `${UNIQUE} deleted-module.txt`,
    });

    await db
      .update(wikiPagesTable)
      .set({ deletedAt: new Date() })
      .where(eq(wikiPagesTable.id, globalPageId));
    await db
      .update(modulesTable)
      .set({ deletedAt: new Date() })
      .where(eq(modulesTable.id, moduleId));

    for (const attachmentId of [globalAttachmentId, moduleAttachmentId]) {
      const hiddenDownload = await request(app)
        .get(`/api/wiki/attachments/${attachmentId}/download`)
        .set(authHeader(reader.token));
      expect(hiddenDownload.status).toBe(404);
    }
    expect(
      (
        await request(app)
          .get(`/api/wiki/pages/${globalPageId}`)
          .set(authHeader(reader.token))
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`/api/wiki/pages/${modulePageId}`)
          .set(authHeader(reader.token))
      ).status,
    ).toBe(404);

    const search = await request(app)
      .get(`/api/wiki/pages?q=${UNIQUE}`)
      .set(authHeader(reader.token));
    const visibleIds = search.body.items.map((item: { id: number }) => item.id);
    expect(visibleIds).not.toContain(globalPageId);
    expect(visibleIds).not.toContain(modulePageId);
  });
});

describe("native wiki Office and ZIP indexing", () => {
  it("indexes bounded Office and ZIP text, then makes the extracted text searchable", async () => {
    const uploader = await makeUser();
    const pageId = await makePage({
      userId: uploader.user.id,
      title: `${UNIQUE} indexed files`,
    });
    const docx = new JSZip();
    docx.file(
      "word/document.xml",
      `<w:document><w:p><w:t>officetext${UNIQUE}</w:t><w:t>&amp; safe</w:t></w:p></w:document>`,
    );
    docx.file("word/comments.xml", `mustnotindex${UNIQUE}`);
    const docxBytes = await docx.generateAsync({ type: "nodebuffer" });
    const extractedDocx = await extractText("report.docx", docxBytes);
    expect(extractedDocx).toContain(`officetext${UNIQUE}`);

    const archive = new JSZip();
    archive.file("docs/summary.txt", `ziptext${UNIQUE}`);
    archive.file("assets/payload.bin", `binarypayload${UNIQUE}`);
    const zipBytes = await archive.generateAsync({ type: "nodebuffer" });
    const extractedZip = await extractText("archive.zip", zipBytes);
    expect(extractedZip).toContain(`ziptext${UNIQUE}`);

    const docxPath = `/objects/uploads/${UNIQUE}docxfile123456`;
    const zipPath = `/objects/uploads/${UNIQUE}zipfile123456`;
    const docxId = await makeAttachment({
      pageId,
      userId: uploader.user.id,
      fileName: "report.docx",
      objectPath: docxPath,
      indexStatus: "pending",
      size: docxBytes.length,
    });
    const zipId = await makeAttachment({
      pageId,
      userId: uploader.user.id,
      fileName: "archive.zip",
      objectPath: zipPath,
      indexStatus: "pending",
      size: zipBytes.length,
    });
    const bytesByPath = new Map([
      [docxPath, docxBytes],
      [zipPath, zipBytes],
    ]);
    vi.spyOn(
      ObjectStorageService.prototype,
      "getObjectEntityFile",
    ).mockImplementation(async (objectPath) => ({
      kind: "local",
      absPath: objectPath,
    }));
    vi.spyOn(
      ObjectStorageService.prototype,
      "downloadObject",
    ).mockImplementation(async (storedObject) => {
      const path = storedObject.kind === "local" ? storedObject.absPath : "";
      const bytes = bytesByPath.get(path);
      if (!bytes) throw new Error("Unexpected test attachment path");
      return new Response(bytes, {
        headers: { "content-length": String(bytes.length) },
      });
    });

    await indexWikiAttachment(docxId);
    await indexWikiAttachment(zipId);
    const indexedRows = await db
      .select({
        id: wikiAttachmentsTable.id,
        indexedText: wikiAttachmentsTable.indexedText,
        indexStatus: wikiAttachmentsTable.indexStatus,
      })
      .from(wikiAttachmentsTable)
      .where(inArray(wikiAttachmentsTable.id, [docxId, zipId]));
    const docxRow = indexedRows.find((row) => row.id === docxId)!;
    const zipRow = indexedRows.find((row) => row.id === zipId)!;
    expect(docxRow.indexStatus).toBe("indexed");
    expect(docxRow.indexedText).toContain(`officetext${UNIQUE}`);
    expect(docxRow.indexedText).toContain("& safe");
    expect(docxRow.indexedText).not.toContain(`mustnotindex${UNIQUE}`);
    expect(zipRow.indexStatus).toBe("indexed");
    expect(zipRow.indexedText).toContain(`ziptext${UNIQUE}`);
    expect(zipRow.indexedText).toContain("assets/payload.bin");
    expect(zipRow.indexedText).not.toContain(`binarypayload${UNIQUE}`);

    const officeSearch = await request(app)
      .get(`/api/wiki/pages?q=officetext${UNIQUE}`)
      .set(authHeader(uploader.token));
    const zipSearch = await request(app)
      .get(`/api/wiki/pages?q=ziptext${UNIQUE}`)
      .set(authHeader(uploader.token));
    expect(
      officeSearch.body.items.map((item: { id: number }) => item.id),
    ).toContain(pageId);
    expect(
      zipSearch.body.items.map((item: { id: number }) => item.id),
    ).toContain(pageId);
  });

  it("skips oversized ZIP members and rejects archives with too many entries", async () => {
    const archive = new JSZip();
    archive.file("notes.txt", "retainedsmalltext");
    archive.file("oversized.txt", "x".repeat(1_100_000));
    const bytes = await archive.generateAsync({ type: "nodebuffer" });
    const extracted = await extractText("bounded.zip", bytes);
    expect(extracted).toContain("notes.txt");
    expect(extracted).toContain("retainedsmalltext");
    expect(extracted).toContain("oversized.txt");
    expect(extracted).not.toContain("x".repeat(100));

    const tooManyEntries = new JSZip();
    for (let index = 0; index <= 1000; index += 1) {
      tooManyEntries.file(`entry-${index}.txt`, "x");
    }
    const oversizedArchive = await tooManyEntries.generateAsync({
      type: "nodebuffer",
    });
    await expect(extractText("too-many.zip", oversizedArchive)).rejects.toThrow(
      "más de 1000",
    );
  });

  it("retries a temporary storage failure and makes recovered text searchable", async () => {
    const uploader = await makeUser();
    const pageId = await makePage({
      userId: uploader.user.id,
      title: `${UNIQUE} recovered attachment`,
    });
    const objectPath = `/objects/uploads/${UNIQUE}recoveredfile123456`;
    const indexedText = `storageRecovery${UNIQUE}`;
    const bytes = Buffer.from(indexedText);
    const attachmentId = await makeAttachment({
      pageId,
      userId: uploader.user.id,
      fileName: "recovered.txt",
      objectPath,
      indexStatus: "pending",
      size: bytes.length,
    });
    vi.spyOn(
      ObjectStorageService.prototype,
      "getObjectEntityFile",
    ).mockResolvedValue({ kind: "local", absPath: objectPath });

    let downloadAttempts = 0;
    vi.spyOn(
      ObjectStorageService.prototype,
      "downloadObject",
    ).mockImplementation(async () => {
      downloadAttempts += 1;
      if (downloadAttempts === 1) throw temporaryStorageError();
      return new Response(bytes, {
        headers: { "content-length": String(bytes.length) },
      });
    });

    await indexWikiAttachment(attachmentId);
    expect(downloadAttempts).toBe(2);

    const [indexedAttachment] = await db
      .select({
        indexStatus: wikiAttachmentsTable.indexStatus,
        indexedText: wikiAttachmentsTable.indexedText,
      })
      .from(wikiAttachmentsTable)
      .where(eq(wikiAttachmentsTable.id, attachmentId));
    expect(indexedAttachment!.indexStatus).toBe("indexed");
    expect(indexedAttachment!.indexedText).toContain(indexedText);

    const search = await request(app)
      .get(`/api/wiki/pages?q=${indexedText}`)
      .set(authHeader(uploader.token));
    expect(search.body.items.map((item: { id: number }) => item.id)).toContain(
      pageId,
    );
  });

  it("stops after the bounded number of transient storage download attempts", async () => {
    const uploader = await makeUser();
    const pageId = await makePage({
      userId: uploader.user.id,
      title: `${UNIQUE} unavailable attachment`,
    });
    const objectPath = `/objects/uploads/${UNIQUE}unavailablefile123456`;
    const attachmentId = await makeAttachment({
      pageId,
      userId: uploader.user.id,
      fileName: "unavailable.txt",
      objectPath,
      indexStatus: "pending",
      size: 20,
    });
    vi.spyOn(
      ObjectStorageService.prototype,
      "getObjectEntityFile",
    ).mockResolvedValue({ kind: "local", absPath: objectPath });

    let downloadAttempts = 0;
    vi.spyOn(
      ObjectStorageService.prototype,
      "downloadObject",
    ).mockImplementation(async () => {
      downloadAttempts += 1;
      throw temporaryStorageError();
    });

    await indexWikiAttachment(attachmentId);
    expect(downloadAttempts).toBe(3);

    const [indexedAttachment] = await db
      .select({
        indexStatus: wikiAttachmentsTable.indexStatus,
        indexedText: wikiAttachmentsTable.indexedText,
      })
      .from(wikiAttachmentsTable)
      .where(eq(wikiAttachmentsTable.id, attachmentId));
    expect(indexedAttachment!.indexStatus).toBe("failed");
    expect(indexedAttachment!.indexedText).toBe("");
  });

  it("marks malformed Office packages as failed without interrupting page access", async () => {
    const uploader = await makeUser();
    const pageId = await makePage({
      userId: uploader.user.id,
      title: `${UNIQUE} malformed office`,
    });
    const objectPath = `/objects/uploads/${UNIQUE}brokenoffice123456`;
    const attachmentId = await makeAttachment({
      pageId,
      userId: uploader.user.id,
      fileName: "broken.docx",
      objectPath,
      indexStatus: "pending",
      size: 15,
    });
    const malformedBytes = Buffer.from("not-a-valid-zip");
    vi.spyOn(
      ObjectStorageService.prototype,
      "getObjectEntityFile",
    ).mockResolvedValue({ kind: "local", absPath: objectPath });
    const downloadSpy = vi.spyOn(
      ObjectStorageService.prototype,
      "downloadObject",
    ).mockResolvedValue(
      new Response(malformedBytes, {
        headers: { "content-length": String(malformedBytes.length) },
      }),
    );

    await indexWikiAttachment(attachmentId);
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const [indexedAttachment] = await db
      .select({
        indexStatus: wikiAttachmentsTable.indexStatus,
        indexedText: wikiAttachmentsTable.indexedText,
      })
      .from(wikiAttachmentsTable)
      .where(eq(wikiAttachmentsTable.id, attachmentId));
    expect(indexedAttachment!.indexStatus).toBe("failed");
    expect(indexedAttachment!.indexedText).toBe("");

    const readablePage = await request(app)
      .get(`/api/wiki/pages/${pageId}`)
      .set(authHeader(uploader.token));
    expect(readablePage.status).toBe(200);
    expect(readablePage.body.attachments[0].indexStatus).toBe("failed");
  });
});
