import { describe, expect, it } from "vitest";
import {
  BACKUP_SCHEMA_MANIFEST,
  BACKUP_TABLE_NAMES,
  backupFingerprint,
  buildBackupPayload,
  collectObjectStorageReferences,
  createRestoredUserSessionState,
  getBackupPostgresTypeName,
  hashObjectStream,
  nextRestoreTokenVersion,
  validateBackupPayload,
  type BackupFile,
} from "../src/routes/backup";

function makeEmptyBackup(): BackupFile {
  const tables = [...BACKUP_TABLE_NAMES].sort();
  const data = Object.fromEntries(tables.map((table) => [table, []]));

  return buildBackupPayload(
    makeDatabaseSchema(),
    data,
    "2026-01-01T00:00:00.000Z",
  );
}

function makeDatabaseSchema() {
  const tables = [...BACKUP_TABLE_NAMES].sort();
  const columns = BACKUP_SCHEMA_MANIFEST.flatMap((table) =>
    table.columns.map((column) => ({
      table: table.name,
      column: column.name,
      type: getBackupPostgresTypeName(column.type),
      hasDefault: column.hasDefault,
      nullable: !column.notNull,
      identity: /Identity/.test(column.columnType),
    })),
  ).sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );

  return {
    tables,
    columns,
    fingerprint: backupFingerprint({ tables, columns }),
  };
}

function makeBackupWithObjectIdentity(
  objects: Array<{ path: string; sha256: string; size: number }>,
): BackupFile {
  const tables = [...BACKUP_TABLE_NAMES].sort();
  const data = Object.fromEntries(tables.map((table) => [table, []]));
  const attachmentTable = BACKUP_SCHEMA_MANIFEST.find(
    (table) => table.name === "wiki_attachments",
  );
  expect(attachmentTable).toBeDefined();
  data.wiki_attachments = [
    Object.fromEntries(
      attachmentTable!.columns.map((column) => [
        column.property,
        column.property === "objectPath" ? "/objects/uploads/test" : null,
      ]),
    ),
  ];
  return buildBackupPayload(
    makeDatabaseSchema(),
    data,
    "2026-01-01T00:00:00.000Z",
    objects,
  );
}

describe("complete backup format", () => {
  it("discovers all exported tables, including reset-token storage", () => {
    expect(BACKUP_TABLE_NAMES).toHaveLength(63);
    expect(BACKUP_TABLE_NAMES).toContain("password_reset_tokens");
  });

  it("includes sessionNonce in the fingerprinted users schema", () => {
    const users = BACKUP_SCHEMA_MANIFEST.find((table) => table.name === "users");
    expect(users?.columns.map(({ property }) => property)).toContain("sessionNonce");
  });

  it("accepts a checksummed complete version 5 payload", () => {
    expect(() => validateBackupPayload(makeEmptyBackup())).not.toThrow();
  });

  it("keeps timestamp checksums valid through JSON serialization", () => {
    const data = Object.fromEntries(BACKUP_TABLE_NAMES.map((table) => [table, []]));
    const provinces = BACKUP_SCHEMA_MANIFEST.find((table) => table.name === "provinces");
    expect(provinces).toBeDefined();
    data.provinces = [
      Object.fromEntries(
        provinces!.columns.map((column) => [
          column.property,
          /Timestamp/.test(column.columnType)
            ? new Date("2026-01-01T00:00:00.000Z")
            : null,
        ]),
      ),
    ];
    const payload = buildBackupPayload(
      makeDatabaseSchema(),
      data,
      "2026-01-01T00:00:00.000Z",
    );
    const downloadedPayload = JSON.parse(JSON.stringify(payload));

    expect(() => validateBackupPayload(downloadedPayload)).not.toThrow();
  });

  it("rejects legacy versions 1 through 4", () => {
    for (const version of [1, 2, 3, 4]) {
      const legacy = JSON.parse(JSON.stringify(makeEmptyBackup())) as BackupFile;
      Object.assign(legacy, { version });
      if (version === 3) {
        delete (legacy.externalObjects as unknown as Record<string, unknown>)
          .objects;
      }
      const { checksum: _checksum, ...unsigned } = legacy;
      legacy.checksum = backupFingerprint(unsigned);

      expect(() => validateBackupPayload(legacy)).toThrow(/versión/i);
    }
  });

  it("rejects a payload missing a table before restore can begin", () => {
    const payload = makeEmptyBackup();
    delete payload.data.password_reset_tokens;

    expect(() => validateBackupPayload(payload)).toThrow(/incompleta|contiene tablas/i);
  });

  it("rejects content changed after the checksum was generated", () => {
    const payload = makeEmptyBackup();
    payload.generatedAt = "2026-01-02T00:00:00.000Z";

    expect(() => validateBackupPayload(payload)).toThrow(/dañada|contenido ha cambiado/i);
  });

  it("collects distinct managed object paths but ignores filenames", () => {
    const references = collectObjectStorageReferences({
      wiki_attachments: [
        {
          objectPath: "/objects/uploads/one",
          fileName: "one.pdf",
        },
        {
          objectPath: "/objects/uploads/one",
          fileName: "one-copy.pdf",
        },
      ],
      messages: [
        {
          attachmentPath: "/objects/uploads/two",
          attachmentName: "two.jpg",
        },
      ],
    });

    expect(references).toEqual([
      {
        table: "messages",
        column: "attachmentPath",
        path: "/objects/uploads/two",
      },
      {
        table: "wiki_attachments",
        column: "objectPath",
        path: "/objects/uploads/one",
      },
    ]);
  });

  it("requires a SHA-256 identity and byte size for every managed object", () => {
    const incomplete = makeBackupWithObjectIdentity([]);
    expect(() => validateBackupPayload(incomplete)).toThrow(/inventario/i);

    const complete = makeBackupWithObjectIdentity([
      {
        path: "/objects/uploads/test",
        sha256: "a".repeat(64),
        size: 42,
      },
    ]);
    expect(() => validateBackupPayload(complete)).not.toThrow();

    complete.externalObjects.objects[0]!.sha256 = "not-a-digest";
    const { checksum: _checksum, ...unsigned } = complete;
    complete.checksum = backupFingerprint(unsigned);
    expect(() => validateBackupPayload(complete)).toThrow(/inventario/i);
  });

  it("always advances restored sessions past archived and current versions", () => {
    expect(nextRestoreTokenVersion(2, 5)).toBe(6);
    expect(nextRestoreTokenVersion(7)).toBe(8);
    expect(() => nextRestoreTokenVersion(2_147_483_647, 2)).toThrow();
  });

  it("issues a fresh session nonce on every restore, even for absent users", () => {
    const archivedNonce = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const first = createRestoredUserSessionState(3);
    const second = createRestoredUserSessionState(3);

    expect(first.tokenVersion).toBe(4);
    expect(first.sessionNonce).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    );
    expect(first.sessionNonce).not.toBe(archivedNonce);
    expect(second.sessionNonce).not.toBe(first.sessionNonce);
  });

  it("hashes object streams incrementally and records their exact size", async () => {
    const budget = { totalBytes: 0 };
    const stream = new Response("abc").body;
    expect(stream).not.toBeNull();

    await expect(hashObjectStream(stream!, budget)).resolves.toEqual({
      sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      size: 3,
    });
    expect(budget.totalBytes).toBe(3);
  });
});