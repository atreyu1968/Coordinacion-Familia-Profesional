import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Silence application logging noise during the test run.
    env: { LOG_LEVEL: "silent" },
    include: ["test/**/*.test.ts"],
    // The realtime layer keeps a module-level Socket.io singleton and all tests
    // share one Postgres database, so run files sequentially to avoid cross-test
    // interference.
    fileParallelism: false,
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
  resolve: {
    // Workspace packages export TypeScript source directly; make sure Vitest
    // transforms them instead of treating them as external node_modules.
    conditions: ["workspace", "import", "node", "default"],
  },
  server: {
    deps: {
      inline: [/@workspace\//],
    },
  },
});
