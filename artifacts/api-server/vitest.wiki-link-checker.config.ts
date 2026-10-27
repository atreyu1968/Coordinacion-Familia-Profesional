import { realpathSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// Reject the normal app connection before any DB module is imported.
const root = process.env.COORDINA_WIKI_CHECKER_TEST_ROOT;
const url = new URL(process.env.DATABASE_URL || "file:///missing");
if (
  !root ||
  !/\/coordina-db-test\.[a-zA-Z0-9]+$/.test(root) ||
  realpathSync(root) !== root ||
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  url.pathname !== "/coordina_wiki_link_checker" ||
  url.searchParams.get("host") !== join(root, "socket")
) {
  throw new Error("Run bash deploy/test-db.sh --wiki-link-checker-only; the app database is forbidden.");
}

export default defineConfig({
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    include: ["test/wiki-link-checker.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 30000,
    testTimeout: 15000,
  },
  resolve: { conditions: ["workspace", "import", "node", "default"] },
  server: { deps: { inline: [/@workspace\//] } },
});
