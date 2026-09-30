import { Router, type IRouter } from "express";
import express from "express";
import JSZip from "jszip";
import { createHash, randomUUID } from "crypto";
import {
  getTableColumns,
  getTableName,
  isTable,
  sql,
  type Table,
} from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import * as dbSchemaExports from "@workspace/db";
import { db, usersTable } from "@workspace/db";
import type { StoredObject } from "../lib/objectAcl";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { requireAuth, requireRole } from "../middlewares/auth";
import { disconnectUserSessions } from "../lib/realtime";

const router: IRouter = Router();

const BACKUP_FORMAT = "coordina-adg-backup";
const BACKUP_VERSION = 5;
const MAX_BACKUP_JSON_BYTES = 256 * 1024 * 1024;
const MAX_OBJECT_HASH_BYTES = 1024 * 1024 * 1024;
const MAX_TOTAL_OBJECT_HASH_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_HASHED_OBJECTS = 50_000;
const MAX_TOKEN_VERSION = 2_147_483_647;
const MIGRATION_TABLES = new Set(["__drizzle_migrations"]);
const objectStorageService = new ObjectStorageService();
const STORAGE_PATH_FIELDS = new Set([
  "objectpath",
  "attachmentpath",
  "logopath",
  "faviconpath",
]);

type ObjectStorageReference = {
  table: string;
  column: string;
  path: string;
};

export type ObjectStorageIdentity = {
  path: string;
  sha256: string;
  size: number;
};

type BackupTable = {
  name: string;
  table: Table;
};

type SchemaColumn = {
  property: string;
  name: string;
  type: string;
  columnType: string;
  dataType: string;
  notNull: boolean;
  primary: boolean;
  hasDefault: boolean;
};

type SchemaForeignKey = {
  columns: string[];
  table: string;
  foreignColumns: string[];
  onDelete: string | null;
  onUpdate: string | null;
};

type SchemaTable = {
  name: string;
  columns: SchemaColumn[];
  primaryKeys: Array<{ name: string | null; columns: string[] }>;
  foreignKeys: SchemaForeignKey[];
};

type DatabaseColumn = {
  table: string;
  column: string;
  type: string;
  hasDefault: boolean;
  nullable: boolean;
  identity: boolean;
};

type ExternalObjectInventory = {
  bytesIncluded: false;
  references: Array<{ table: string; column: string; count: number }>;
  objects: ObjectStorageIdentity[];
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  generatedAt: string;
  schema: {
    fingerprint: string;
    tables: SchemaTable[];
  };
  databaseSchema: {
    fingerprint: string;
    tables: string[];
    columns: DatabaseColumn[];
  };
  externalObjects: ExternalObjectInventory;
  data: Record<string, Record<string, unknown>[]>;
  checksum: string;
};

function getExportedTables(): BackupTable[] {
  const seen = new Set<string>();
  const tables = Object.values(dbSchemaExports).filter(isTable) as unknown as Table[];
  const result = tables.map((table) => {
    const name = getTableName(table);
    if (seen.has(name)) {
      throw new Error(`Duplicate exported database table "${name}"`);
    }
    seen.add(name);
    return { name, table };
  });
  return orderBackupTables(result);
}

export function orderBackupTables(tables: readonly BackupTable[]): BackupTable[] {
  const byName = new Map(tables.map((entry) => [entry.name, entry]));
  const dependencies = new Map<string, Set<string>>();
  for (const { name, table } of tables) {
    const parents = new Set(
      getTableConfig(table as PgTable).foreignKeys
        .map((foreignKey) => getTableName(foreignKey.reference().foreignTable))
        .filter((parent) => byName.has(parent)),
    );
    dependencies.set(name, parents);
  }

  const ordered: BackupTable[] = [];
  while (dependencies.size > 0) {
    const ready = [...dependencies]
      .filter(([, parents]) => parents.size === 0)
      .map(([name]) => name)
      .sort();
    if (ready.length === 0) {
      throw new Error("Database schema contains a foreign-key cycle; backup order is unsafe.");
    }
    for (const name of ready) {
      const table = byName.get(name);
      if (table) ordered.push(table);
      dependencies.delete(name);
      for (const parents of dependencies.values()) parents.delete(name);
    }
  }
  return ordered;
}

const TABLES = getExportedTables();
const TABLE_NAMES = TABLES.map(({ name }) => name);

function getCodeSchemaManifest(): SchemaTable[] {
  return TABLES.map(({ name, table }) => {
    const config = getTableConfig(table as PgTable);
    const columns = getTableColumns(table);
    const propertyByColumn = new Map(
      Object.entries(columns).map(([property, column]) => [column.name, property]),
    );
    const foreignKeys = config.foreignKeys
      .map((foreignKey) => {
        const reference = foreignKey.reference();
        return {
          columns: reference.columns.map((column) => column.name),
          table: getTableName(reference.foreignTable),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          onDelete: foreignKey.onDelete ?? null,
          onUpdate: foreignKey.onUpdate ?? null,
        };
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    return {
      name,
      columns: config.columns.map((column) => ({
        property: propertyByColumn.get(column.name) ?? column.name,
        name: column.name,
        type: column.getSQLType(),
        columnType: column.columnType,
        dataType: column.dataType,
        notNull: column.notNull,
        primary: column.primary,
        hasDefault: column.hasDefault,
      })),
      primaryKeys: config.primaryKeys.map((primaryKey) => ({
        name: primaryKey.name ?? null,
        columns: primaryKey.columns.map((column) => column.name),
      })),
      foreignKeys,
    };
  });
}

function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

const CODE_SCHEMA = getCodeSchemaManifest();
const CODE_SCHEMA_FINGERPRINT = fingerprint(CODE_SCHEMA);
export const BACKUP_TABLE_NAMES = [...TABLE_NAMES];
export const BACKUP_SCHEMA_MANIFEST = CODE_SCHEMA;
export const backupFingerprint = fingerprint;

export function nextRestoreTokenVersion(
  archivedVersion: number,
  currentVersion?: number,
): number {
  for (const version of [archivedVersion, currentVersion].filter(
    (value): value is number => value !== undefined,
  )) {
    if (
      !Number.isSafeInteger(version) ||
      version < 0 ||
      version > MAX_TOKEN_VERSION
    ) {
      throw new Error("La versión de sesión está fuera del rango admitido.");
    }
  }
  const next = Math.max(archivedVersion, currentVersion ?? -1) + 1;
  if (next > MAX_TOKEN_VERSION) {
    throw new Error(
      "No es posible aumentar la versión de sesión sin exceder el límite de la base de datos.",
    );
  }
  return next;
}

export function createRestoredUserSessionState(
  archivedVersion: number,
  currentVersion?: number,
): { tokenVersion: number; sessionNonce: string } {
  return {
    tokenVersion: nextRestoreTokenVersion(archivedVersion, currentVersion),
    sessionNonce: randomUUID(),
  };
}

function hasSessionNonceSchemaColumn(): boolean {
  return Object.hasOwn(getTableColumns(usersTable), "sessionNonce");
}

function postgresTypeName(sqlType: string): string {
  const typeNames: Record<string, string> = {
    boolean: "bool",
    date: "date",
    "double precision": "float8",
    integer: "int4",
    "integer[]": "_int4",
    jsonb: "jsonb",
    serial: "int4",
    text: "text",
    "text[]": "_text",
    "timestamp with time zone": "timestamptz",
  };
  return typeNames[sqlType] ?? sqlType;
}

export const getBackupPostgresTypeName = postgresTypeName;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return stableStringify(Object.keys(value).sort()) ===
    stableStringify([...expected].sort());
}

async function readDatabaseSchema(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const schemaResult = await tx.execute(sql`SELECT current_schema() AS schema_name`);
  const tablesResult = await tx.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  const columnsResult = await tx.execute(sql`
    SELECT table_name, column_name, udt_name, column_default, is_nullable, is_identity
    FROM information_schema.columns
    WHERE table_schema = current_schema()
    ORDER BY table_name, ordinal_position
  `);
  const schemaName = String(schemaResult.rows[0]?.schema_name ?? "");
  if (!schemaName) throw new Error("Could not determine the active database schema.");

  const tables = tablesResult.rows
    .map((row) => String(row.table_name))
    .filter((name) => !MIGRATION_TABLES.has(name))
    .sort();
  const columns = columnsResult.rows
    .filter((row) => !MIGRATION_TABLES.has(String(row.table_name)))
    .map((row) => ({
      table: String(row.table_name),
      column: String(row.column_name),
      type: String(row.udt_name),
      hasDefault: row.column_default !== null || row.is_identity === "YES",
      nullable: row.is_nullable === "YES",
      identity: row.is_identity === "YES",
    }));
  columns.sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );

  const expectedTables = [...TABLE_NAMES].sort();
  if (stableStringify(tables) !== stableStringify(expectedTables)) {
    throw new Error(
      "The database contains missing or unregistered tables; backup/restore is disabled until the application schema is reconciled.",
    );
  }

  const columnsByTable = new Map<string, string[]>();
  for (const column of columns) {
    const current = columnsByTable.get(column.table) ?? [];
    current.push(column.column);
    columnsByTable.set(column.table, current);
  }
  for (const table of TABLES) {
    const actual = (columnsByTable.get(table.name) ?? []).sort();
    const expected = Object.values(getTableColumns(table.table))
      .map((column) => column.name)
      .sort();
    if (stableStringify(actual) !== stableStringify(expected)) {
      throw new Error(
        `Database columns do not match the application schema for table "${table.name}".`,
      );
    }
  }
  const actualColumnMetadata = columns.map(
    ({ table, column, type, hasDefault, nullable, identity }) => ({
      table,
      column,
      type,
      hasDefault,
      nullable,
      identity,
    }),
  );
  const expectedColumnMetadata = CODE_SCHEMA.flatMap((table) =>
    table.columns.map((column) => ({
      table: table.name,
      column: column.name,
      type: postgresTypeName(column.type),
      hasDefault: column.hasDefault,
      nullable: !column.notNull,
      identity: /Identity/.test(column.columnType),
    })),
  ).sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );
  if (
    stableStringify(actualColumnMetadata) !==
    stableStringify(expectedColumnMetadata)
  ) {
    throw new Error(
      "Database column types or constraints do not match the application schema.",
    );
  }

  return {
    schemaName,
    manifest: {
      fingerprint: fingerprint({ tables, columns }),
      tables,
      columns,
    },
  };
}

function collectExternalObjects(
  data: Record<string, Record<string, unknown>[]>,
  objects: ObjectStorageIdentity[] = [],
): ExternalObjectInventory {
  const counts = new Map<string, number>();
  const visit = (value: unknown, table: string, column: string): void => {
    if (typeof value === "string") {
      const fileLikeColumn =
        /(?:objectPath|attachmentPath|fileUrl|logoPath|faviconPath)$/i.test(column);
      if (
        value.startsWith("/objects/") ||
        /^https:\/\/storage\.googleapis\.com\//i.test(value) ||
        (fileLikeColumn && value.length > 0)
      ) {
        const key = `${table}\0${column}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, table, column);
      return;
    }
    if (plainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, table, column ? `${column}.${childKey}` : childKey);
      }
    }
  };

  for (const [table, rows] of Object.entries(data)) {
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) visit(value, table, column);
    }
  }

  return {
    bytesIncluded: false,
    references: [...counts.entries()]
      .map(([key, count]) => {
        const [table, column] = key.split("\0");
        return { table: table!, column: column!, count };
      })
      .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)),
    objects: [...objects].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export function collectObjectStorageReferences(
  data: Record<string, Record<string, unknown>[]>,
): ObjectStorageReference[] {
  const references = new Map<string, ObjectStorageReference>();
  const visit = (value: unknown, table: string, column: string): void => {
    if (typeof value === "string") {
      const field = column.split(".").at(-1)?.toLowerCase() ?? "";
      const managedField = STORAGE_PATH_FIELDS.has(field);
      if (
        (managedField && value.trim().length > 0) ||
        value.startsWith("/objects/") ||
        /^https:\/\/storage\.googleapis\.com\//i.test(value)
      ) {
        const key = `${table}\0${column}\0${value}`;
        references.set(key, { table, column, path: value });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, table, column);
      return;
    }
    if (plainObject(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, table, column ? `${column}.${childKey}` : childKey);
      }
    }
  };

  for (const [table, rows] of Object.entries(data)) {
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) visit(value, table, column);
    }
  }
  return [...references.values()].sort(
    (a, b) =>
      a.table.localeCompare(b.table) ||
      a.column.localeCompare(b.column) ||
      a.path.localeCompare(b.path),
  );
}

function publicObjectLocationFromUrl(
  rawUrl: string,
): { bucket: string; objectName: string; relativePath: string } | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com") {
      return null;
    }
    const decodedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const [bucket, ...objectParts] = decodedPath.split("/");
    if (!bucket || objectParts.length === 0) return null;
    const fullObjectName = objectParts.join("/");

    for (const searchPath of objectStorageService.getPublicObjectSearchPaths()) {
      const configuredPrefix = searchPath.replace(/^\/+|\/+$/g, "");
      if (!configuredPrefix) continue;
      const prefixParts = configuredPrefix.split("/");
      const configuredBucket = prefixParts.shift();
      const configuredObjectPrefix = prefixParts.join("/");
      if (configuredBucket !== bucket) continue;
      if (
        configuredObjectPrefix &&
        fullObjectName.startsWith(`${configuredObjectPrefix}/`)
      ) {
        return {
          bucket,
          objectName: fullObjectName,
          relativePath: fullObjectName.slice(configuredObjectPrefix.length + 1),
        };
      }
      if (!configuredObjectPrefix) {
        return { bucket, objectName: fullObjectName, relativePath: fullObjectName };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function validObjectEntityPath(path: string): boolean {
  if (!path.startsWith("/objects/")) return false;
  const parts = path.slice("/objects/".length).split("/");
  return parts.length > 0 && parts.every((part) => part && part !== "." && part !== "..");
}

async function resolveObjectReference(
  reference: ObjectStorageReference,
): Promise<StoredObject> {
  if (validObjectEntityPath(reference.path)) {
    return objectStorageService.getObjectEntityFile(reference.path);
  }

  if (/^https:\/\/storage\.googleapis\.com\//i.test(reference.path)) {
    try {
      const normalized = objectStorageService.normalizeObjectEntityPath(reference.path);
      if (validObjectEntityPath(normalized)) {
        return objectStorageService.getObjectEntityFile(normalized);
      }
    } catch {
      // A public GCS object may not have PRIVATE_OBJECT_DIR configured; try its
      // configured public search prefixes below before marking it unverifiable.
    }

    const publicLocation = publicObjectLocationFromUrl(reference.path);
    if (!publicLocation) {
      throw new Error("The object URL is not covered by configured storage paths.");
    }
    const publicObject = await objectStorageService.searchPublicObject(
      publicLocation.relativePath,
    );
    if (!publicObject) throw new ObjectNotFoundError();
    if (
      publicObject.kind !== "gcs" ||
      publicObject.file.bucket.name !== publicLocation.bucket ||
      publicObject.file.name !== publicLocation.objectName
    ) {
      throw new Error("The public object URL could not be verified exactly.");
    }
    return publicObject;
  }

  throw new Error("The object reference is not a supported storage path.");
}

export type ObjectHashBudget = { totalBytes: number };

export async function hashObjectStream(
  body: ReadableStream<Uint8Array>,
  budget: ObjectHashBudget,
): Promise<{ sha256: string; size: number }> {
  const reader = body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      budget.totalBytes += value.byteLength;
      if (
        size > MAX_OBJECT_HASH_BYTES ||
        budget.totalBytes > MAX_TOTAL_OBJECT_HASH_BYTES
      ) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Object hashing exceeded its configured size limit.");
      }
      hash.update(
        Buffer.from(value.buffer, value.byteOffset, value.byteLength),
      );
    }
  } finally {
    reader.releaseLock();
  }

  return { sha256: hash.digest("hex"), size };
}

async function calculateObjectIdentity(
  reference: ObjectStorageReference,
  budget: ObjectHashBudget,
): Promise<ObjectStorageIdentity> {
  const storedObject = await resolveObjectReference(reference);
  const response = await objectStorageService.downloadObject(storedObject, 0);
  if (!response.body) throw new Error("The object storage stream is unavailable.");

  const advertisedSize = Number(response.headers.get("content-length"));
  if (
    Number.isSafeInteger(advertisedSize) &&
    advertisedSize > MAX_OBJECT_HASH_BYTES
  ) {
    await response.body.cancel().catch(() => undefined);
    throw new Error("The object exceeds the safe hashing limit.");
  }

  const identity = await hashObjectStream(response.body, budget);
  return { path: reference.path, ...identity };
}

async function createObjectIdentities(
  data: Record<string, Record<string, unknown>[]>,
): Promise<ObjectStorageIdentity[]> {
  const referencesByPath = new Map<string, ObjectStorageReference>();
  for (const reference of collectObjectStorageReferences(data)) {
    if (!referencesByPath.has(reference.path)) {
      referencesByPath.set(reference.path, reference);
    }
  }
  const paths = [...referencesByPath.keys()].sort();
  if (paths.length > MAX_HASHED_OBJECTS) {
    throw new Error("The backup contains too many distinct stored objects to hash safely.");
  }

  const budget: ObjectHashBudget = { totalBytes: 0 };
  const identities: ObjectStorageIdentity[] = [];
  for (const path of paths) {
    identities.push(
      await calculateObjectIdentity(referencesByPath.get(path)!, budget),
    );
  }
  return identities;
}

async function verifyObjectStorageIdentities(
  data: Record<string, Record<string, unknown>[]>,
  expectedIdentities: ObjectStorageIdentity[],
): Promise<{
  checked: number;
  missing: ObjectStorageReference[];
  mismatched: ObjectStorageReference[];
  unverifiable: ObjectStorageReference[];
}> {
  const references = collectObjectStorageReferences(data);
  const referencesByPath = new Map<string, ObjectStorageReference[]>();
  for (const reference of references) {
    const grouped = referencesByPath.get(reference.path) ?? [];
    grouped.push(reference);
    referencesByPath.set(reference.path, grouped);
  }
  const expectedByPath = new Map(
    expectedIdentities.map((identity) => [identity.path, identity]),
  );
  const missing: ObjectStorageReference[] = [];
  const mismatched: ObjectStorageReference[] = [];
  const unverifiable: ObjectStorageReference[] = [];

  const budget: ObjectHashBudget = { totalBytes: 0 };
  for (const [path, pathReferences] of referencesByPath) {
    const expected = expectedByPath.get(path);
    if (!expected) {
      unverifiable.push(...pathReferences);
      continue;
    }
    try {
      const actual = await calculateObjectIdentity(pathReferences[0]!, budget);
      if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
        mismatched.push(...pathReferences);
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) missing.push(...pathReferences);
      else unverifiable.push(...pathReferences);
    }
  }
  return {
    checked: referencesByPath.size,
    missing,
    mismatched,
    unverifiable,
  };
}

function safeReferenceForResponse(reference: ObjectStorageReference) {
  let displayPath = reference.path;
  try {
    const url = new URL(reference.path);
    displayPath = `${url.origin}${url.pathname}`;
  } catch {
    // Canonical /objects paths contain no query secrets and are safe to show.
  }
  return {
    table: reference.table,
    column: reference.column,
    path: displayPath.slice(0, 240),
  };
}

function checksumInput(payload: Omit<BackupFile, "checksum">): string {
  return stableStringify(payload);
}

export function validateBackupPayload(value: unknown): asserts value is BackupFile {
  if (!plainObject(value)) throw new Error("El archivo de copia de seguridad no es válido.");
  const payload = value as unknown as Partial<BackupFile>;
  if (
    !hasExactKeys(value, [
      "format",
      "version",
      "generatedAt",
      "schema",
      "databaseSchema",
      "externalObjects",
      "data",
      "checksum",
    ])
  ) {
    throw new Error("La copia de seguridad contiene campos inesperados.");
  }
  if (payload.format !== BACKUP_FORMAT) {
    throw new Error("El archivo no es una copia de seguridad de Coordina ADG.");
  }
  if (payload.version !== BACKUP_VERSION) {
    throw new Error(
      `La versión de la copia de seguridad (${String(payload.version)}) no es compatible con esta plataforma.`,
    );
  }
  if (
    typeof payload.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.generatedAt)) ||
    !plainObject(payload.schema) ||
    !plainObject(payload.databaseSchema) ||
    !plainObject(payload.externalObjects) ||
    !plainObject(payload.data) ||
    typeof payload.checksum !== "string"
  ) {
    throw new Error("La copia de seguridad está incompleta o tiene un formato no válido.");
  }

  if (
    payload.schema.fingerprint !== CODE_SCHEMA_FINGERPRINT ||
    !hasExactKeys(payload.schema, ["fingerprint", "tables"]) ||
    stableStringify(payload.schema.tables) !== stableStringify(CODE_SCHEMA)
  ) {
    throw new Error("La copia de seguridad pertenece a un esquema de aplicación distinto.");
  }

  const data = payload.data as Record<string, unknown>;
  const dataTables = Object.keys(data).sort();
  if (stableStringify(dataTables) !== stableStringify([...TABLE_NAMES].sort())) {
    throw new Error(
      "La copia está incompleta o contiene tablas que esta versión no reconoce; no se modificó ningún dato.",
    );
  }

  for (const { name, table } of TABLES) {
    const rows = data[name];
    if (!Array.isArray(rows) || !rows.every(plainObject)) {
      throw new Error(`La copia tiene datos no válidos en la tabla "${name}".`);
    }
    const columns = getTableColumns(table);
    const expectedKeys = Object.keys(columns).sort();
    for (const row of rows as Record<string, unknown>[]) {
      const rowKeys = Object.keys(row).sort();
      if (stableStringify(rowKeys) !== stableStringify(expectedKeys)) {
        throw new Error(`Una fila de la tabla "${name}" no coincide con su esquema.`);
      }
      for (const [property, column] of Object.entries(columns)) {
        const value = row[property];
        if (name === "users" && property === "id") {
          if (
            typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value <= 0
          ) {
            throw new Error("La copia contiene un identificador de usuario no válido.");
          }
        }
        if (name === "users" && property === "tokenVersion") {
          if (
            typeof value !== "number" ||
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value > MAX_TOKEN_VERSION
          ) {
            throw new Error("La copia contiene una versión de sesión no válida.");
          }
        }
        if (name === "users" && property === "sessionNonce") {
          if (
            typeof value !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              value,
            )
          ) {
            throw new Error("La copia contiene un nonce de sesión no válido.");
          }
        }
        if (
          /Timestamp/.test(column.columnType) &&
          !/String/.test(column.columnType) &&
          typeof value === "string" &&
          !Number.isFinite(Date.parse(value))
        ) {
          throw new Error(`Una fecha de la tabla "${name}" no es válida.`);
        }
      }
    }
  }

  const backupData = data as Record<string, Record<string, unknown>[]>;
  const expectedExternalObjects = collectExternalObjects(backupData);
  const externalObjects = payload.externalObjects as unknown as Record<
    string,
    unknown
  >;
  const expectedObjectPaths = [
    ...new Set(collectObjectStorageReferences(backupData).map(({ path }) => path)),
  ].sort();
  const identities = externalObjects.objects;
  const validIdentities =
    Array.isArray(identities) &&
    identities.every(
      (identity) =>
        plainObject(identity) &&
        hasExactKeys(identity, ["path", "sha256", "size"]) &&
        typeof identity.path === "string" &&
        /^[a-f0-9]{64}$/.test(String(identity.sha256)) &&
        Number.isSafeInteger(identity.size) &&
        Number(identity.size) >= 0 &&
        Number(identity.size) <= MAX_OBJECT_HASH_BYTES,
    );
  const actualObjectPaths = Array.isArray(identities)
    ? identities.map((identity) =>
        plainObject(identity) && typeof identity.path === "string"
          ? identity.path
          : "",
      )
    : [];
  const objectSizes = Array.isArray(identities)
    ? identities.reduce(
        (total, identity) =>
          plainObject(identity) && typeof identity.size === "number"
            ? total + identity.size
            : total,
        0,
      )
    : 0;
  if (
    !hasExactKeys(externalObjects, ["bytesIncluded", "references", "objects"]) ||
    externalObjects.bytesIncluded !== false ||
    stableStringify(externalObjects.references) !==
      stableStringify(expectedExternalObjects.references) ||
    !validIdentities ||
    (Array.isArray(identities) && identities.length > MAX_HASHED_OBJECTS) ||
    stableStringify(actualObjectPaths) !== stableStringify(expectedObjectPaths) ||
    objectSizes > MAX_TOTAL_OBJECT_HASH_BYTES
  ) {
    throw new Error("El inventario de archivos externos no coincide con los datos de la copia.");
  }

  const databaseSchema = payload.databaseSchema as BackupFile["databaseSchema"];
  if (
    !Array.isArray(databaseSchema.tables) ||
    !Array.isArray(databaseSchema.columns) ||
    !hasExactKeys(databaseSchema as unknown as Record<string, unknown>, [
      "fingerprint",
      "tables",
      "columns",
    ])
  ) {
    throw new Error("La firma del esquema de base de datos de la copia no es válida.");
  }
  const expectedDatabaseTables = [...TABLE_NAMES].sort();
  const expectedDatabaseColumnMetadata = CODE_SCHEMA.flatMap((table) =>
    table.columns.map((column) => ({
      table: table.name,
      column: column.name,
      type: postgresTypeName(column.type),
      hasDefault: column.hasDefault,
      nullable: !column.notNull,
      identity: /Identity/.test(column.columnType),
    })),
  ).sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  );
  const actualDatabaseColumns = databaseSchema.columns
    .filter(plainObject)
    .map((column) => ({
      table: String(column.table),
      column: String(column.column),
      type: column.type,
      hasDefault: column.hasDefault,
      nullable: column.nullable,
      identity: column.identity,
    }))
    .sort(
      (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
    );
  const databaseColumnsAreValid = databaseSchema.columns.every(
    (column) =>
      plainObject(column) &&
      Object.keys(column).sort().join(",") ===
        ["column", "hasDefault", "identity", "nullable", "table", "type"]
          .sort()
          .join(",") &&
      typeof column.table === "string" &&
      typeof column.column === "string" &&
      typeof column.type === "string" &&
      typeof column.hasDefault === "boolean" &&
      typeof column.nullable === "boolean" &&
      typeof column.identity === "boolean",
  );
  if (
    !Array.isArray(databaseSchema.tables) ||
    !Array.isArray(databaseSchema.columns) ||
    stableStringify(databaseSchema.tables) !== stableStringify(expectedDatabaseTables) ||
    !databaseColumnsAreValid ||
    stableStringify(actualDatabaseColumns) !==
      stableStringify(expectedDatabaseColumnMetadata) ||
    typeof databaseSchema.fingerprint !== "string" ||
    databaseSchema.fingerprint !==
      fingerprint({ tables: databaseSchema.tables, columns: databaseSchema.columns })
  ) {
    throw new Error("La firma del esquema de base de datos de la copia no es válida.");
  }

  const { checksum, ...unsignedPayload } = payload as BackupFile;
  if (checksum !== fingerprint(checksumInput(unsignedPayload))) {
    throw new Error("La copia de seguridad está dañada o su contenido ha cambiado.");
  }
}

// Restore values come back as plain JSON: PostgreSQL timestamps are ISO strings.
// Calendar strings and JSON string values are deliberately left untouched.
function reviveRow(table: Table, row: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table);
  const out = { ...row };
  for (const [key, column] of Object.entries(columns)) {
    const value = out[key];
    if (
      /Timestamp/.test(column.columnType) &&
      !/String/.test(column.columnType) &&
      typeof value === "string"
    ) {
      out[key] = new Date(value);
    }
  }
  return out;
}

function serialColumns(table: Table): Array<{ name: string }> {
  return getTableConfig(table as PgTable).columns
    .filter((column) => /Serial|Identity/.test(column.columnType))
    .map((column) => ({ name: column.name }));
}

export function buildBackupPayload(
  databaseSchema: BackupFile["databaseSchema"],
  data: BackupFile["data"],
  generatedAt = new Date().toISOString(),
  objectIdentities: ObjectStorageIdentity[] = [],
): BackupFile {
  const unsignedPayload: Omit<BackupFile, "checksum"> = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    generatedAt,
    schema: { fingerprint: CODE_SCHEMA_FINGERPRINT, tables: CODE_SCHEMA },
    databaseSchema,
    externalObjects: collectExternalObjects(data, objectIdentities),
    data,
  };
  return {
    ...unsignedPayload,
    checksum: fingerprint(checksumInput(unsignedPayload)),
  };
}

async function readZipEntryWithLimit(
  entry: JSZip.JSZipObject,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  const stream = entry.nodeStream("nodebuffer") as NodeJS.ReadableStream & AsyncIterable<Buffer>;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) throw new Error("El archivo de copia supera el tamaño descomprimido permitido.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
router.get(
  "/backup",
  requireAuth,
  requireRole("superadmin"),
  async (_req, res): Promise<void> => {
    if (!hasSessionNonceSchemaColumn()) {
      res.status(503).json({
        message:
          "No se puede generar la copia: el esquema de usuarios todavía no incluye sessionNonce.",
      });
      return;
    }
    try {
      const snapshot = await db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`);
        const liveSchema = await readDatabaseSchema(tx);
        const data: BackupFile["data"] = {};
        for (const { name, table } of TABLES) {
          data[name] = (await tx.select().from(table)) as Record<string, unknown>[];
        }
        return { databaseSchema: liveSchema.manifest, data };
      });
      const objectIdentities = await createObjectIdentities(snapshot.data);
      const payload = buildBackupPayload(
        snapshot.databaseSchema,
        snapshot.data,
        new Date().toISOString(),
        objectIdentities,
      );

      const json = JSON.stringify(payload, null, 2);
      if (Buffer.byteLength(json, "utf8") > MAX_BACKUP_JSON_BYTES) {
        res.status(413).json({
          message: "La copia supera el tamaño máximo permitido para una exportación.",
        });
        return;
      }

      const zip = new JSZip();
      zip.file("backup.json", json);
      const buffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      const date = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="coordina-adg-backup-${date}.zip"`,
      );
      res.send(buffer);
    } catch {
      res.status(503).json({
        message:
          "No se pudo generar la copia. Compruebe que la base de datos coincide con el esquema registrado y que los objetos administrados por el almacenamiento pueden leerse para calcular sus huellas.",
      });
    }
  },
);

router.post(
  "/restore",
  requireAuth,
  requireRole("superadmin"),
  express.raw({ type: "application/zip", limit: "300mb" }),
  async (req, res): Promise<void> => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({
        message: "No se ha recibido ningún archivo de copia de seguridad.",
      });
      return;
    }

    let parsedPayload: unknown;
    try {
      const zip = await JSZip.loadAsync(body);
      if (Object.keys(zip.files).length !== 1 || !zip.files["backup.json"]) {
        res.status(400).json({
          message: "El archivo ZIP debe contener únicamente backup.json.",
        });
        return;
      }
      const entry = zip.file("backup.json");
      if (!entry || entry.dir) {
        res.status(400).json({
          message:
            "El archivo no es una copia de seguridad válida (falta backup.json).",
        });
        return;
      }
      const json = await readZipEntryWithLimit(entry, MAX_BACKUP_JSON_BYTES);
      parsedPayload = JSON.parse(json);
    } catch (error) {
      res.status(400).json({
        message:
          error instanceof Error && error.message.includes("supera el tamaño")
            ? error.message
            : "No se ha podido leer el archivo ZIP de copia de seguridad.",
      });
      return;
    }

    try {
      validateBackupPayload(parsedPayload);
    } catch (error) {
      res.status(400).json({
        message:
          error instanceof Error
            ? error.message
            : "El archivo de copia de seguridad está incompleto o no es válido.",
      });
      return;
    }

    if (!hasSessionNonceSchemaColumn()) {
      res.status(503).json({
        message:
          "No se puede restaurar esta copia: el esquema de usuarios todavía no incluye sessionNonce.",
      });
      return;
    }

    const payload = parsedPayload;
    const objectVerification = await verifyObjectStorageIdentities(
      payload.data,
      payload.externalObjects.objects,
    );
    if (objectVerification.missing.length > 0) {
      res.status(409).json({
        message:
          `Restauración bloqueada: faltan ${objectVerification.missing.length} archivos ` +
          "referenciados en el almacenamiento actual. No se modificó la base de datos.",
        missingObjects: objectVerification.missing.map(safeReferenceForResponse),
        mismatchedObjects: objectVerification.mismatched.map(
          safeReferenceForResponse,
        ),
        unverifiableObjects: objectVerification.unverifiable.map(
          safeReferenceForResponse,
        ),
      });
      return;
    }
    if (objectVerification.mismatched.length > 0) {
      res.status(409).json({
        message:
          `Restauración bloqueada: ${objectVerification.mismatched.length} archivos ` +
          "referenciados no coinciden con la huella y el tamaño incluidos en la copia. " +
          "No se modificó la base de datos.",
        mismatchedObjects: objectVerification.mismatched.map(
          safeReferenceForResponse,
        ),
      });
      return;
    }
    if (objectVerification.unverifiable.length > 0) {
      res.status(503).json({
        message:
          `No se pudieron verificar ${objectVerification.unverifiable.length} archivos ` +
          "referenciados. No se modificó la base de datos.",
        unverifiableObjects: objectVerification.unverifiable.map(
          safeReferenceForResponse,
        ),
      });
      return;
    }

    const counts: Record<string, number> = {};
    let previousUserIds: number[] = [];
    let restoredUserIds: number[] = [];
    try {
      await db.transaction(async (tx) => {
        const beforeLock = await readDatabaseSchema(tx);
        for (const tableName of [...TABLE_NAMES].sort()) {
          await tx.execute(
            sql.raw(
              `LOCK TABLE ${quoteIdentifier(beforeLock.schemaName)}.${quoteIdentifier(tableName)} IN ACCESS EXCLUSIVE MODE`,
            ),
          );
        }
        const liveSchema = await readDatabaseSchema(tx);
        if (
          stableStringify(liveSchema.manifest) !==
          stableStringify(payload.databaseSchema)
        ) {
          throw new Error("La base de datos no coincide con el esquema incluido en la copia.");
        }
        for (const { table } of TABLES) {
          for (const column of serialColumns(table)) {
            const columnConfig = getTableConfig(table as PgTable).columns.find(
              (candidate) => candidate.name === column.name,
            );
            if (columnConfig?.columnType.includes("Identity")) {
              throw new Error(
                "La restauración de columnas identity no está habilitada para este esquema.",
              );
            }
            const sequenceTableName =
              `${quoteIdentifier(liveSchema.schemaName)}.${quoteIdentifier(getTableName(table))}`;
            const sequenceResult = await tx.execute(sql.raw(
              `SELECT pg_get_serial_sequence(${quoteSqlString(sequenceTableName)}, ${quoteSqlString(column.name)}) AS sequence_name`,
            ));
            if (!sequenceResult.rows[0]?.sequence_name) {
              throw new Error(
                `No se encontró la secuencia de la columna "${column.name}" en "${getTableName(table)}".`,
              );
            }
          }
        }

        const currentUsers = await tx
          .select({
            id: usersTable.id,
            tokenVersion: usersTable.tokenVersion,
          })
          .from(usersTable);
        const currentTokenVersions = new Map(
          currentUsers.map((user) => [user.id, user.tokenVersion]),
        );
        const restoredSessionStates = new Map<
          number,
          { tokenVersion: number; sessionNonce: string }
        >();
        const archivedUsers = payload.data.users;
        for (const user of archivedUsers) {
          const userId = user.id as number;
          restoredSessionStates.set(
            userId,
            createRestoredUserSessionState(
              user.tokenVersion as number,
              currentTokenVersions.get(userId),
            ),
          );
        }
        previousUserIds = currentUsers.map(({ id }) => id);
        restoredUserIds = archivedUsers.map((user) => user.id as number);

        // Wipe child tables before parents; the whole replacement is atomic.
        for (const { table } of [...TABLES].reverse()) {
          await tx.delete(table);
        }

        for (const { name, table } of TABLES) {
          const rows = payload.data[name];
          if (rows.length === 0) {
            counts[name] = 0;
            continue;
          }
          const revived = rows.map((row) => {
            const revivedRow = reviveRow(
              table,
              row as Record<string, unknown>,
            );
            if (name === "users") {
              const sessionState = restoredSessionStates.get(
                revivedRow.id as number,
              );
              if (!sessionState) {
                throw new Error("No se pudo generar el estado de sesión restaurado.");
              }
              revivedRow.tokenVersion = sessionState.tokenVersion;
              revivedRow.sessionNonce = sessionState.sessionNonce;
            }
            return revivedRow;
          });
          const CHUNK = 250;
          for (let i = 0; i < revived.length; i += CHUNK) {
            await tx.insert(table).values(revived.slice(i, i + CHUNK));
          }
          counts[name] = revived.length;
        }

        // Restore generated-key counters after explicit IDs have been inserted.
        for (const { name, table } of TABLES) {
          const qualifiedTable =
            `${quoteIdentifier(liveSchema.schemaName)}.${quoteIdentifier(name)}`;
          for (const column of serialColumns(table)) {
            const sequenceTableName =
              `${quoteIdentifier(liveSchema.schemaName)}.${quoteIdentifier(name)}`;
            const maxColumn = `MAX(${quoteIdentifier(column.name)})`;
            await tx.execute(
              sql.raw(
                `SELECT setval(pg_get_serial_sequence(${quoteSqlString(sequenceTableName)}, ${quoteSqlString(column.name)}), ` +
                  `GREATEST(COALESCE((SELECT ${maxColumn} FROM ${qualifiedTable}), 1), 1), ` +
                  `EXISTS (SELECT 1 FROM ${qualifiedTable}))`,
              ),
            );
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        message:
          error instanceof Error &&
          error.message.includes("no coincide con el esquema incluido")
            ? error.message
            : "No se pudo restaurar la copia. La transacción se canceló y los datos existentes se conservaron.",
      });
      return;
    }

    for (const userId of new Set([...previousUserIds, ...restoredUserIds])) {
      disconnectUserSessions(userId);
    }

    res.json({
      restored: true,
      counts,
      sessionsDisconnected: true,
      externalObjects: {
        bytesIncluded: false,
        references: payload.externalObjects.references.length,
        verifiedObjects: objectVerification.checked,
        managedObjectIdentitiesVerified: true,
        warning:
          "Los bytes de los archivos no están incluidos en el ZIP. Se verificaron las huellas SHA-256 y tamaños de los objetos administrados por el almacenamiento actual; las URL externas no se copian ni se verifican. Para migrar, copie los objetos al destino antes de restaurar.",
      },
    });
  },
);

export default router;
