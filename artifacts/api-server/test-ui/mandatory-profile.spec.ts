import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Fixtures {
  accounts: Record<string, { email: string; password: string; id: number }>;
  centerId: number;
  centerName: string;
  provinceId: number;
  moduleId: number;
  moduleName: string;
  year: string;
}
const fixtures: Fixtures = JSON.parse(readFileSync(join(process.env.COORDINA_PROFILE_UI_ROOT!, "ready.json"), "utf8"));
const title = "Completa tu perfil docente";
const gate = (page: Page) => page.getByText(title, { exact: true });

test.beforeEach(async ({ context, baseURL }) => {
  // Fail closed if a stale mobile bundle ever contains a different API origin.
  // This is a network allowlist, not a mocked API: allowed traffic is unchanged.
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort("blockedbyclient"),
  );
});

async function assertBlocked(page: Page, mobile: boolean) {
  await expect(gate(page)).toBeVisible();
  if (mobile) {
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole("button", { name: "Volver", exact: true })).toHaveCount(0);
  } else {
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Close", exact: true })).toHaveCount(0);
  }
}

async function selectCenter(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "Seleccionar centro", exact: true }).click();
    await page.getByRole("button", { name: fixtures.centerName, exact: true }).click();
  } else {
    await page.getByRole("combobox", { name: "Centro", exact: true }).click();
    await page.getByRole("option", { name: fixtures.centerName, exact: true }).click();
  }
  await expect(page.getByRole("checkbox", { name: new RegExp(fixtures.moduleName) })).toBeVisible();
}

for (const role of ["teacher", "department_head", "coordinator", "superadmin"]) {
  for (const state of ["no-center", "no-modules"]) {
    test(`${role}: ${state} cannot bypass onboarding and saved teaching data survives reload`, async ({ page }, testInfo) => {
      const mobile = testInfo.project.name === "mobile";
      const account = fixtures.accounts[`${testInfo.project.name}/${role}/${state}`];
      // A fresh browser context per test; no injected tokens or mocked API responses.
      await page.goto("/login");
      if (mobile) {
        await page.getByPlaceholder("nombre@coordinaadg.es").fill(account.email);
        await page.getByPlaceholder("••••••••", { exact: true }).fill(account.password);
      } else {
        await page.getByLabel("Correo electrónico", { exact: true }).fill(account.email);
        await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
      }
      await page.getByRole("button", { name: /Iniciar sesi[oó]n/i }).click();
      await assertBlocked(page, mobile);

      await test.step("Escape, outside click, direct navigation and browser Back cannot dismiss the gate", async () => {
        await page.keyboard.press("Escape");
        if (!mobile) await page.mouse.click(5, 5);
        await assertBlocked(page, mobile);
        await page.goto(mobile ? "/alerts" : "/usuarios");
        await assertBlocked(page, mobile);
        await page.goBack();
        await assertBlocked(page, mobile);
        await page.reload();
        await assertBlocked(page, mobile);
      });

      const save = page.getByRole("button", { name: "Guardar datos docentes", exact: true });
      if (state === "no-center") {
        await save.click();
        await expect(page.getByText("Selecciona tu centro.", { exact: true })).toBeVisible();
        await assertBlocked(page, mobile);
        await selectCenter(page, mobile);
      }
      await save.click();
      await expect(page.getByText("Selecciona un módulo o declara que no impartes clase.", { exact: true })).toBeVisible();
      await assertBlocked(page, mobile);

      const noTeaching = state === "no-modules";
      const selection = noTeaching
        ? page.getByRole("checkbox", { name: /No imparto clase durante el curso/ })
        : page.getByRole("checkbox", { name: new RegExp(fixtures.moduleName) });
      await selection.click();
      const savedResponse = page.waitForResponse(response =>
        response.url().includes("/api/auth/me/teaching-profile") && response.request().method() === "PATCH",
      );
      await save.click();
      const response = await savedResponse;
      if (role === "department_head" && state === "no-center") {
        // A jefatura's center is also its management scope. This regression
        // must not grant it a new administrative scope through self-service.
        expect(response.status()).toBe(404);
        await expect(page.getByText("No se pudo guardar el centro y los módulos.", { exact: true })).toBeVisible();
        await assertBlocked(page, mobile);
        await page.reload();
        await assertBlocked(page, mobile);
        const centerField = mobile
          ? page.getByRole("button", { name: "Seleccionar centro", exact: true })
          : page.getByRole("combobox", { name: "Centro", exact: true });
        await expect(centerField).toContainText("Selecciona tu centro");
        return;
      }
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({
        user: { id: account.id, role, centerId: fixtures.centerId, provinceId: fixtures.provinceId },
        doesNotTeach: noTeaching,
        moduleIds: noTeaching ? [] : [fixtures.moduleId],
      });
      await expect(gate(page)).toHaveCount(0);

      await test.step("Server persistence, not just local state, unlocks the next load", async () => {
        await page.reload();
        await expect(gate(page)).toHaveCount(0);
        // Visit a protected screen and ensure the onboarding is not forced again.
        await page.goto(mobile ? "/alerts" : "/usuarios");
        await expect(page.getByText(mobile ? "Alertas de empresa" : "Usuarios", { exact: true }).first()).toBeVisible();
        await expect(gate(page)).toHaveCount(0);
        if (mobile) {
          await page.goto("/perfil");
          await expect(page.getByText("Editar perfil", { exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Seleccionar centro", exact: true })).toContainText(fixtures.centerName);
        } else {
          await page.getByRole("button", { name: "Editar perfil", exact: true }).click();
          await expect(page.getByRole("combobox", { name: "Centro", exact: true })).toContainText(fixtures.centerName);
        }
        await expect(selection).toBeChecked();
        if (noTeaching) {
          await expect(page.getByRole("checkbox", { name: new RegExp(fixtures.moduleName) })).not.toBeChecked();
        }
      });
    });
  }
}
