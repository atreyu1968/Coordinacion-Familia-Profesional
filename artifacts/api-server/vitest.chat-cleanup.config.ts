import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: { LOG_LEVEL: "silent" },
    include: ["test/academic-year-chat-cleanup.isolation.test.ts"],
    exclude: ["**/node_modules/**"],
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
