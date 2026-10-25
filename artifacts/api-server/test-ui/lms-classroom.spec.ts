import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Fixtures {
  classroomAccount: { email: string; password: string };
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
  const mobile = testInfo.project.name === "mobile";
  await page.goto("/login");
  if (mobile) {
    await page.getByPlaceholder("nombre@coordinaadg.es").fill(fixtures.classroomAccount.email);
    await page.getByPlaceholder("••••••••", { exact: true }).fill(fixtures.classroomAccount.password);
  } else {
    await page.getByLabel("Correo electrónico", { exact: true }).fill(fixtures.classroomAccount.email);
    await page.getByLabel("Contraseña", { exact: true }).fill(fixtures.classroomAccount.password);
  }
  const loginResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Iniciar sesi[oó]n/i }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

  await page.goto(mobile ? `/lms/${fixtures.classroomCourseId}` : `/autodirigido?curso=${fixtures.classroomCourseId}`);
  await expect(page.getByText("Contenido de prueba: presentación y objetivos.", { exact: true })).toBeVisible();
  await expect(page.getByText("VERI*FACTU: curso de demostración", { exact: false }).first()).toBeVisible();

  if (mobile) {
    await page.getByRole("button", { name: /Mostrar temario del curso/ }).click();
    await page.getByRole("button", { name: /Lección 2: Normativa y comprobación/ }).click();
    await expect(page.getByText("Contenido de prueba: normativa y comprobación.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lección siguiente" }).click();
    await expect(page.getByText("Contenido de prueba: caso práctico.", { exact: true })).toBeVisible();
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
