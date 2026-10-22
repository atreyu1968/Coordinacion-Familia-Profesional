import { defineConfig } from "vitest/config";
import base from "./vitest.config";

export default defineConfig({
  ...base,
  test: { ...base.test, include: ["test/test-teacher-cleanup.isolation.test.ts"], exclude: [] },
});
