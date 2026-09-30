import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as schema from "../lib/db/src/schema/index";

type ActualColumn = {
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  default: string | null;
};

type ExpectedColumn = {
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  default: string | number | boolean | undefined;
  defaultRequired: boolean;
};

type Key = {
  type: "primary" | "unique" | "foreign";
  table: string;
  columns: string[];
  foreignTable: string | null;
  foreignColumns: string[];
};

type IndexInfo = {
  table: string;
  name: string;
  unique: boolean;
  columns: string[];
};

type ExpectedIndex = Omit<IndexInfo, "columns"> & {
  columns: string[] | null;
};

type Catalog = {
  columns: ActualColumn[];
  constraints: Key[];
  indexes: IndexInfo[];
  enums: Array<{ name: string; labels: string[] }>;
};

const allowMissingUpgradeColumns =
  process.argv.includes("--allow-missing-upgrade-columns");
const tableNameSymbol = Symbol.for("drizzle:Name");
const tableColumnsSymbol = Symbol.for("drizzle:Columns");
const isDrizzleTableSymbol = Symbol.for("drizzle:IsDrizzleTable");
const requireFromDb = createRequire(new URL("../lib/db/package.json", import.meta.url));
const { getTableConfig } = requireFromDb("drizzle-orm/pg-core") as {
  getTableConfig: (table: object) => {
    primaryKeys: Array<{ columns: Array<{ name: string }> }>;
    uniqueConstraints: Array<{ columns: Array<{ name: string }> }>;
    indexes: Array<{
      config: {
        name?: unknown;
        unique?: boolean;
        columns: Array<{ name?: unknown }>;
      };
    }>;
    foreignKeys: Array<{
      reference: () => {
        columns: Array<{ name: string }>;
        foreignTable: Record<PropertyKey, unknown>;
        foreignColumns: Array<{ name: string }>;
      };
    }>;
  };
};

function fail(message: string): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(1);
}

function expectedType(sqlType: string): string {
  const normalized = sqlType.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.startsWith("serial")) return "integer";
  if (normalized.startsWith("bigserial")) return "bigint";
  if (normalized.startsWith("smallserial")) return "smallint";
  if (normalized.startsWith("varchar")) {
    return normalized.replace(/^varchar/, "character varying");
  }
  return normalized;
}

function getExpectedSchema(): {
  columns: ExpectedColumn[];
  constraints: Key[];
  indexes: ExpectedIndex[];
  enums: Array<{ name: string; labels: string[] }>;
} {
  const expected: ExpectedColumn[] = [];
  const constraints: Key[] = [];
  const indexes: ExpectedIndex[] = [];
  for (const value of Object.values(schema)) {
    if (typeof value !== "object" || value === null) continue;
    const table = value as unknown as Record<PropertyKey, unknown>;
    if (table[isDrizzleTableSymbol] !== true) continue;
    const tableName = table[tableNameSymbol];
    const columns = table[tableColumnsSymbol];
    if (
      typeof tableName !== "string" ||
      typeof columns !== "object" ||
      columns === null
    ) {
      fail("Cannot inspect a table exported by the Drizzle application schema.");
    }

    const config = getTableConfig(value);
    for (const column of Object.values(columns)) {
      if (typeof column !== "object" || column === null) {
        fail(`Cannot inspect a column in application table ${tableName}.`);
      }
      const metadata = column as {
        name?: unknown;
        notNull?: unknown;
        getSQLType?: () => string;
        primary?: unknown;
        isUnique?: unknown;
        hasDefault?: unknown;
        default?: unknown;
        defaultFn?: unknown;
      };
      if (
        typeof metadata.name !== "string" ||
        typeof metadata.getSQLType !== "function" ||
        typeof metadata.notNull !== "boolean"
      ) {
        fail(`Cannot inspect a column in application table ${tableName}.`);
      }
      const type = expectedType(metadata.getSQLType());
      const defaultValue =
        typeof metadata.default === "string" ||
        typeof metadata.default === "number" ||
        typeof metadata.default === "boolean"
          ? metadata.default
          : undefined;
      expected.push({
        table: tableName,
        column: metadata.name,
        type,
        nullable: !metadata.notNull,
        default: defaultValue,
        defaultRequired:
          metadata.default !== undefined ||
          (type === "integer" &&
            metadata.getSQLType().toLowerCase() === "serial") ||
          (metadata.hasDefault === true && metadata.defaultFn === undefined),
      });
      if (metadata.primary === true) {
        constraints.push({
          type: "primary",
          table: tableName,
          columns: [metadata.name],
          foreignTable: null,
          foreignColumns: [],
        });
      }
      if (metadata.isUnique === true) {
        constraints.push({
          type: "unique",
          table: tableName,
          columns: [metadata.name],
          foreignTable: null,
          foreignColumns: [],
        });
      }
    }

    for (const key of config.primaryKeys) {
      constraints.push({
        type: "primary",
        table: tableName,
        columns: key.columns.map((column) => column.name),
        foreignTable: null,
        foreignColumns: [],
      });
    }
    for (const key of config.uniqueConstraints) {
      constraints.push({
        type: "unique",
        table: tableName,
        columns: key.columns.map((column) => column.name),
        foreignTable: null,
        foreignColumns: [],
      });
    }
    for (const index of config.indexes) {
      if (typeof index.config.name !== "string") {
        fail(`Cannot inspect an index name in application table ${tableName}.`);
      }
      const indexColumns = index.config.columns.every(
        (column) => typeof column.name === "string",
      )
        ? index.config.columns.map((column) => column.name as string)
        : null;
      indexes.push({
        table: tableName,
        name: index.config.name,
        unique: index.config.unique === true,
        columns: indexColumns,
      });
      if (index.config.unique === true && indexColumns !== null) {
        constraints.push({
          type: "unique",
          table: tableName,
          columns: indexColumns,
          foreignTable: null,
          foreignColumns: [],
        });
      }
    }
    for (const foreignKey of config.foreignKeys) {
      const reference = foreignKey.reference();
      const foreignTable = reference.foreignTable[tableNameSymbol];
      if (typeof foreignTable !== "string") {
        fail(`Cannot inspect a foreign-key target from application table ${tableName}.`);
      }
      constraints.push({
        type: "foreign",
        table: tableName,
        columns: reference.columns.map((column) => column.name),
        foreignTable,
        foreignColumns: reference.foreignColumns.map((column) => column.name),
      });
    }
  }

  if (expected.length === 0 || !expected.some((column) => column.table === "users")) {
    fail("The Drizzle schema did not expose the expected application tables.");
  }

  const enums = Object.values(schema).flatMap((value) => {
    if (typeof value !== "function") return [];
    const enumMetadata = value as unknown as {
      enumName?: unknown;
      enumValues?: unknown;
    };
    if (
      typeof enumMetadata.enumName !== "string" ||
      !Array.isArray(enumMetadata.enumValues)
    ) {
      return [];
    }
    if (!enumMetadata.enumValues.every((label) => typeof label === "string")) {
      fail(`Cannot inspect labels for Drizzle enum ${enumMetadata.enumName}.`);
    }
    return [{
      name: enumMetadata.enumName,
      labels: [...enumMetadata.enumValues] as string[],
    }];
  });

  const emailUnique = constraints.some(
    (key) =>
      key.type === "unique" &&
      key.table === "users" &&
      key.columns.length === 1 &&
      key.columns[0] === "email",
  );
  if (!emailUnique) fail("Drizzle schema metadata did not expose users.email UNIQUE.");
  if (!enums.some((enumType) => enumType.name === "role")) {
    fail("Drizzle schema metadata did not expose the required role enum.");
  }

  return { columns: expected, constraints, indexes, enums };
}

function getActualCatalog(): Catalog {
  const sql = `
    SELECT json_build_object(
      'columns', COALESCE((
        SELECT json_agg(json_build_object(
          'table', c.table_name,
          'column', c.column_name,
          'type', lower(format_type(a.atttypid, a.atttypmod)),
          'nullable', c.is_nullable = 'YES',
          'default', pg_get_expr(d.adbin, d.adrelid)
        ))
        FROM information_schema.columns c
        JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
        JOIN pg_catalog.pg_class t ON t.relnamespace = n.oid AND t.relname = c.table_name
        JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid
          AND a.attname = c.column_name AND NOT a.attisdropped
        LEFT JOIN pg_catalog.pg_attrdef d
          ON d.adrelid = t.oid AND d.adnum = a.attnum
        WHERE c.table_schema = 'public'
      ), '[]'::json),
      'constraints', COALESCE((
        SELECT json_agg(item)
        FROM (
          SELECT json_build_object(
            'type', CASE c.contype WHEN 'p' THEN 'primary' WHEN 'u' THEN 'unique' ELSE 'foreign' END,
            'table', t.relname,
            'columns', ARRAY(
              SELECT a.attname
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, position)
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid = c.conrelid AND a.attnum = k.attnum
              ORDER BY k.position
            ),
            'foreignTable', f.relname,
            'foreignColumns', CASE WHEN c.contype = 'f' THEN ARRAY(
              SELECT a.attname
              FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, position)
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid = c.confrelid AND a.attnum = k.attnum
              ORDER BY k.position
            ) ELSE ARRAY[]::name[] END
          ) AS item
          FROM pg_catalog.pg_constraint c
          JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
          LEFT JOIN pg_catalog.pg_class f ON f.oid = c.confrelid
          WHERE n.nspname = 'public' AND c.contype IN ('p', 'u', 'f')

          UNION ALL

          SELECT json_build_object(
            'type', 'unique',
            'table', t.relname,
            'columns', ARRAY(
              SELECT a.attname
              FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
              JOIN pg_catalog.pg_attribute a
                ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              WHERE k.position <= i.indnkeyatts
              ORDER BY k.position
            ),
            'foreignTable', NULL,
            'foreignColumns', ARRAY[]::name[]
          ) AS item
          FROM pg_catalog.pg_index i
          JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = 'public'
            AND i.indisunique
            AND NOT i.indisprimary
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conindid = i.indexrelid AND c.contype IN ('p', 'u')
            )
        ) all_constraints
      ), '[]'::json),
      'indexes', COALESCE((
        SELECT json_agg(json_build_object(
          'table', t.relname,
          'name', index_table.relname,
          'unique', i.indisunique,
          'columns', ARRAY(
            SELECT a.attname
            FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, position)
            JOIN pg_catalog.pg_attribute a
              ON a.attrelid = i.indrelid AND a.attnum = k.attnum
            WHERE k.position <= i.indnkeyatts AND k.attnum > 0
            ORDER BY k.position
          )
        ))
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_catalog.pg_class index_table ON index_table.oid = i.indexrelid
        WHERE n.nspname = 'public'
      ), '[]'::json),
      'enums', COALESCE((
        SELECT json_agg(json_build_object('name', t.typname, 'labels', labels.values))
        FROM pg_catalog.pg_type t
        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
        JOIN LATERAL (
          SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
          FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid
        ) labels ON labels.values IS NOT NULL
        WHERE n.nspname = 'public' AND t.typtype = 'e'
      ), '[]'::json)
    )::text
  `;

  try {
    const result = execFileSync(
      "psql",
      [
        "--no-password",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "service=coordina_migration",
        `--command=${sql}`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return JSON.parse(result) as Catalog;
  } catch {
    fail("Could not read the public PostgreSQL schema for verification.");
  }
}

const expected = getExpectedSchema();
const actual = getActualCatalog();
const actualByKey = new Map(
  actual.columns.map((column) => [`${column.table}.${column.column}`, column]),
);
const problems: string[] = [];

for (const column of expected.columns) {
  const key = `${column.table}.${column.column}`;
  const found = actualByKey.get(key);
  if (!found) {
    if (
      allowMissingUpgradeColumns &&
      ((column.table === "users" &&
        ["token_version", "session_nonce", "legal_accepted_at", "legal_terms_version", "legal_privacy_version"].includes(column.column)) ||
       (column.table === "invitations" &&
        ["max_uses", "used_count"].includes(column.column)))
    ) {
      continue;
    }
    problems.push(`missing ${key}`);
    continue;
  }
  if (
    found.type !== column.type ||
    found.nullable !== column.nullable
  ) {
    problems.push(
      `${key} expected ${column.type}${column.nullable ? "" : " NOT NULL"}, found ${found.type}${found.nullable ? " NULL" : " NOT NULL"}`,
    );
  }
  if (column.defaultRequired) {
    if (found.default === null) {
      problems.push(`${key} is missing its database default`);
    } else if (column.default !== undefined &&
      typeof column.default === "string" &&
      !(
        found.default === `'${column.default.replaceAll("'", "''")}'` ||
        found.default.startsWith(`'${column.default.replaceAll("'", "''")}'::`)
      )
    ) {
      problems.push(`${key} has an unexpected string default`);
    } else if (column.default !== undefined &&
      typeof column.default === "number" &&
      found.default.replace(/[()]/g, "").replace(/::[a-z0-9_ ]+$/i, "").trim() !==
        String(column.default)
    ) {
      problems.push(`${key} has an unexpected numeric default`);
    } else if (column.default !== undefined &&
      typeof column.default === "boolean" &&
      found.default.toLowerCase() !== String(column.default)
    ) {
      problems.push(`${key} has an unexpected boolean default`);
    }
  } else if (found.default !== null) {
    problems.push(`${key} has an unexpected database default`);
  }
}

function keySignature(key: Key): string {
  const columns =
    key.type === "foreign" ? key.columns : [...key.columns].sort();
  const foreignColumns =
    key.type === "foreign" ? key.foreignColumns : [];
  return JSON.stringify([
    key.type,
    key.table,
    columns,
    key.foreignTable,
    foreignColumns,
  ]);
}

const actualKeys = new Set(actual.constraints.map(keySignature));
for (const key of expected.constraints) {
  if (!actualKeys.has(keySignature(key))) {
    problems.push(
      `missing ${key.type} key on ${key.table} (${key.columns.join(", ")})` +
        (key.foreignTable
          ? ` referencing ${key.foreignTable} (${key.foreignColumns.join(", ")})`
          : ""),
    );
  }
}

for (const index of expected.indexes) {
  const found = actual.indexes.find(
    (candidate) =>
      candidate.table === index.table && candidate.name === index.name,
  );
  if (!found) {
    problems.push(`missing index ${index.name} on ${index.table}`);
    continue;
  }
  if (found.unique !== index.unique) {
    problems.push(
      `index ${index.name} on ${index.table} expected UNIQUE=${index.unique}, found UNIQUE=${found.unique}`,
    );
  }
  if (index.columns !== null &&
    JSON.stringify(found.columns) !== JSON.stringify(index.columns)
  ) {
    problems.push(
      `index ${index.name} on ${index.table} expected key columns (${index.columns.join(", ")}), found (${found.columns.join(", ")})`,
    );
  }
}

const actualEnums = new Map(actual.enums.map((value) => [value.name, value.labels]));
for (const enumType of expected.enums) {
  const labels = actualEnums.get(enumType.name);
  if (!labels || JSON.stringify(labels) !== JSON.stringify(enumType.labels)) {
    problems.push(
      `enum ${enumType.name} expected labels [${enumType.labels.join(", ")}], found [${labels?.join(", ") ?? "missing"}]`,
    );
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `Database schema is not compatible with this release:\n${problems
      .map((problem) => ` - ${problem}`)
      .join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Verified ${new Set(expected.columns.map((column) => column.table)).size} application tables, ${expected.columns.length} columns, required keys, enum labels, and declared defaults; unrelated custom tables are left untouched.\n`,
);