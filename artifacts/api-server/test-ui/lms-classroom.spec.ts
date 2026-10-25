import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Fixtures {
  classroomAccounts: Record<string, { email: string; password: string }>;
  classroomCourseId: number;
}

const fixtures: Fixtures = JSON.parse(
  readFileSync(join(process.env.COORDINA_PROFILE_UI_ROOT!, "ready.json"), "utf8"),
);

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
});

test("teacher can sign in and navigate the real demo classroom", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name !== "desktop";
  const surface = mobile ? "mobile" : "desktop";
  const account = fixtures.classroomAccounts[surface];
  await page.goto("/login");
  if (mobile) {
    await page.getByPlaceholder("nombre@coordinaadg.es").fill(account.email);
    await page.getByPlaceholder("••••••••", { exact: true }).fill(account.password);
  } else {
    await page.getByLabel("Correo electrónico", { exact: true }).fill(account.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
  }
  const loginResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Iniciar sesi[oó]n/i }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

  await page.goto(mobile ? `/lms/${fixtures.classroomCourseId}` : `/autodirigido?curso=${fixtures.classroomCourseId}`);
  if (testInfo.project.name !== "mobile-tablet") {
    await expect(page.getByText("Contenido de prueba: presentación y objetivos.", { exact: true })).toBeVisible();
  }
  await expect(page.getByText("VERI*FACTU: curso de demostración", { exact: false }).first()).toBeVisible();

  if (mobile) {
    const classroomUrl = page.url();
    if (testInfo.project.name === "mobile-tablet") {
      expect(await page.evaluate<number>("window.innerWidth")).toBe(1024);
      await page.getByRole("button", { name: /Lección 1: Presentación y objetivos/ }).click();
      await expect(page.getByText("Contenido de prueba: presentación y objetivos.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Lección 2: Normativa y comprobación/ }).click();
      await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /Lección 2: Normativa y comprobación/ })).toBeVisible();
      expect(page.url()).toBe(classroomUrl);
      expect(page.context().pages()).toHaveLength(1);
      await page.getByRole("button", { name: "Lección siguiente" }).click();
      await expect(page.getByText("Contenido de prueba: caso práctico.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Lección anterior" }).click();
      await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Contraer temario", exact: true }).first().click();
      await expect(page.getByRole("button", { name: "Expandir temario", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Expandir temario", exact: true }).click();
      await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("lms-classroom-tablet.png") });
      return;
    }

    expect(await page.evaluate<number>("window.innerWidth")).toBe(400);
    await page.getByRole("button", { name: "Abrir temario", exact: true }).click();
    await page.getByRole("button", { name: /Lección 2: Normativa y comprobación/ }).click();
    await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Lección 2: Normativa y comprobación/ })).toHaveCount(0);
    expect(page.url()).toBe(classroomUrl);
    expect(page.context().pages()).toHaveLength(1);

    await page.getByRole("button", { name: "Lección siguiente" }).click();
    await expect(page.getByText("Contenido de prueba: caso práctico.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lección anterior" }).click();
    await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();

    // On a phone the curriculum closes after selecting a lesson, but can be
    // opened again without leaving the active lesson.
    await page.getByRole("button", { name: "Abrir temario", exact: true }).click();
    await expect(page.getByRole("button", { name: /Lección 2: Normativa y comprobación/ })).toBeVisible();
    await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();

    // Pinning and unpinning the course toolbar must not hide the app header.
    await page.getByRole("button", { name: "Desfijar encabezado compacto", exact: true }).click();
    await page.getByRole("button", { name: "Fijar encabezado compacto", exact: true }).click();
    await expect(page.getByText("Aula", { exact: true })).toBeVisible();

    await page.screenshot({ path: testInfo.outputPath("lms-classroom-mobile.png") });
    return;
  }

  const curriculum = page.getByRole("complementary", { name: "Currículo del curso" });
  const stage = page.locator("#lms-stage");
  const curriculumBounds = await curriculum.boundingBox();
  const stageBounds = await stage.boundingBox();
  expect(curriculumBounds).not.toBeNull();
  expect(stageBounds).not.toBeNull();
  expect(curriculumBounds!.x).toBeLessThan(stageBounds!.x);

  await curriculum.getByRole("button", { name: /Normativa y comprobación/ }).click();
  await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();
  await page.getByRole("navigation", { name: "Navegación entre lecciones" })
    .getByRole("button", { name: /Siguiente/ }).click();
  await expect(page.getByText("Contenido de prueba: caso práctico.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Contraer contenido del curso" }).click();
  await expect(page.getByText("Contenido de prueba: caso práctico.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Desactivar encabezado fijo" }).click();
  await page.screenshot({ path: testInfo.outputPath("lms-classroom-desktop.png") });
});

test("PWA does not ask for biometrics when returning from an app-opened link", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "This regression covers the installed mobile PWA.");
  const account = fixtures.classroomAccounts.mobile;
  await page.goto("/login");
  await page.getByPlaceholder("nombre@coordinaadg.es").fill(account.email);
  await page.getByPlaceholder("••••••••", { exact: true }).fill(account.password);
  const loginResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Iniciar sesi[oó]n/i }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

  // Enable the real resume-lock path while using a one-time handoff marker to
  // keep the initial page reload authenticated in this isolated browser test.
  await page.evaluate(() => {
    localStorage.setItem("coordina_adg_biometric", "1");
    sessionStorage.setItem(
      "coordina_adg_external_browser_resume",
      String(Date.now() + 30_000),
    );
  });
  await page.reload();
  await page.getByRole("tab", { name: /Más/ }).click();
  const corporateEmail = page.getByTestId("more-item-correo-corporativo");
  await expect(corporateEmail).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await corporateEmail.click();
  const popup = await popupPromise;
  const simulateBackgroundAndResume = async () => {
    await page.evaluate(() => {
      const browserGlobals = globalThis as unknown as {
        document: {
          visibilityState: string;
          dispatchEvent: (event: unknown) => boolean;
        };
        Event: new (type: string) => unknown;
      };
      const doc = browserGlobals.document;
      const original = Object.getOwnPropertyDescriptor(doc, "visibilityState");
      Object.defineProperty(doc, "visibilityState", { configurable: true, value: "hidden" });
      doc.dispatchEvent(new browserGlobals.Event("visibilitychange"));
      Object.defineProperty(doc, "visibilityState", { configurable: true, value: "visible" });
      doc.dispatchEvent(new browserGlobals.Event("visibilitychange"));
      if (original) Object.defineProperty(doc, "visibilityState", original);
      else Reflect.deleteProperty(doc, "visibilityState");
    });
  };

  await simulateBackgroundAndResume();
  await expect(page.getByText("App bloqueada", { exact: true })).toHaveCount(0);
  await popup.close();
  await page.waitForTimeout(300);

  // Ordinary background/resume still applies the biometric lock.
  await simulateBackgroundAndResume();
  await expect(page.getByText("App bloqueada", { exact: true })).toBeVisible();
});
