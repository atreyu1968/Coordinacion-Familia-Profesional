import { defineConfig } from "@playwright/test";

if (!process.env.COORDINA_PROFILE_UI_ROOT || !process.env.PROFILE_UI_WEB_URL || !process.env.PROFILE_UI_MOBILE_URL) {
  throw new Error("Run bash scripts/test-profile-ui.sh (never against the preview or a shared database).");
}
for (const origin of [process.env.PROFILE_UI_WEB_URL, process.env.PROFILE_UI_MOBILE_URL]) {
  const parsed = new URL(origin);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "https:") {
    throw new Error("Only the isolated runner's loopback HTTPS origins may be tested.");
  }
}

export default defineConfig({
  testDir: "./test-ui",
  testMatch: ["mandatory-profile.spec.ts", "lms-classroom.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "../../generated-artifacts/profile-ui/results",
  reporter: [
    ["list"],
    ["html", { outputFolder: "../../generated-artifacts/profile-ui/report", open: "never" }],
  ],
  use: {
    browserName: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  projects: [
    { name: "desktop", use: { baseURL: process.env.PROFILE_UI_WEB_URL, viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { baseURL: process.env.PROFILE_UI_MOBILE_URL, viewport: { width: 400, height: 820 }, isMobile: true, hasTouch: true } },
    {
      name: "mobile-tablet",
      testMatch: ["lms-classroom.spec.ts"],
      use: { baseURL: process.env.PROFILE_UI_MOBILE_URL, viewport: { width: 1024, height: 900 } },
    },
  ],
});
