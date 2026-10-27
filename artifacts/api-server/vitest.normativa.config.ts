import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node", env: { LOG_LEVEL: "silent" },
    include: ["test/normativa*.test.ts"], fileParallelism: false,
    maxWorkers: 1, minWorkers: 1, testTimeout: 30000, hookTimeout: 30000,
  },
  resolve: { conditions: ["workspace", "import", "node", "default"] },
  server: { deps: { inline: [/@workspace\//] } },
});
