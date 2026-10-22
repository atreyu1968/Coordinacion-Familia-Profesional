import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["test/ai-knowledge-isolation.test.ts", "test/ai-knowledge-nextcloud.unit.test.ts"],
    exclude: [],
  },
});
