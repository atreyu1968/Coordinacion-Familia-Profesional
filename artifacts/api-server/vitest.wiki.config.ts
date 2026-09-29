import { defineConfig } from "vitest/config";

const wikiTestDatabaseUrl = process.env.WIKI_TEST_DATABASE_URL;
if (!wikiTestDatabaseUrl) {
  throw new Error(
    "WIKI_TEST_DATABASE_URL must point to an isolated PostgreSQL test database; wiki tests will not fall back to DATABASE_URL.",
  );
}

function databaseTarget(connectionString: string): string {
  const url = new URL(connectionString);
  const defaultPort =
    url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? "5432"
      : "";
  return `${url.protocol}//${url.hostname.toLowerCase()}:${url.port || defaultPort}${decodeURIComponent(url.pathname)}`;
}

const configuredAppDatabaseUrl = process.env.DATABASE_URL;
if (
  configuredAppDatabaseUrl &&
  databaseTarget(wikiTestDatabaseUrl) ===
    databaseTarget(configuredAppDatabaseUrl)
) {
  throw new Error(
    "WIKI_TEST_DATABASE_URL resolves to the configured app database; refusing to run wiki tests against it.",
  );
}

// The DB client is initialized from DATABASE_URL when test modules are loaded.
process.env.DATABASE_URL = wikiTestDatabaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    include: ["test/native-wiki.test.ts"],
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
  resolve: {
    conditions: ["workspace", "import", "node", "default"],
  },
  server: {
    deps: {
      inline: [/@workspace\//],
    },
  },
});
