import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { notificationPath } from "./notification-router";

interface Account {
  email: string;
  password: string;
  id: number;
  token: string;
  expiredToken: string;
  user: Record<string, unknown>;
}
const fixtures: {
  notificationAccounts: Record<"member" | "outsider" | "incomplete", Account>;
  notificationEvent: { id: number; name: string };
  notificationCertificateId: number;
} = JSON.parse(readFileSync(join(process.env.COORDINA_PROFILE_UI_ROOT!, "ready.json"), "utf8"));
const accounts = fixtures.notificationAccounts;
const event = fixtures.notificationEvent;
const profileGate = "Completa tu perfil docente";

// Follow the real shared router rather than copying its decisions into a test
// dispatcher. Legacy notices without IDs are intentionally supported too.
const destinations = [
  { type: "event", path: notificationPath({ type: "event", eventId: event.id }), heading: "Eventos" },
  { type: "meeting_minutes", path: notificationPath({ type: "meeting_minutes", eventId: event.id }), heading: "Actas de coordinación" },
  { type: "certificate", path: notificationPath({ type: "certificate", certificateId: fixtures.notificationCertificateId }), heading: "Mis certificados" },
  // The reader's dynamic ID must also survive the login guard, not just lists.
  { type: "acta-detail", path: `/acta/${event.id}`, heading: "Acta" },
];

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", route =>
    new URL(route.request().url()).origin === origin
      ? route.continue() : route.abort("blockedbyclient"),
  );
});

async function login(page: Page, account: Account, password = account.password) {
  await page.getByPlaceholder("nombre@coordinaadg.es").fill(account.email);
  await page.getByPlaceholder("••••••••", { exact: true }).fill(password);
  const response = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: /Iniciar sesi[oó]n/i }).click();
  return response;
}

async function savedSession(page: Page, account: Account, state: "locked" | "expired") {
  // Set up only the saved-device state. Login, profile checks and all target
  // requests still use the real API and disposable DB, without response mocks.
  await page.addInitScript(({ account, state }) => {
    type Store = { getItem(key: string): string | null; setItem(key: string, value: string): void };
    const browser = globalThis as unknown as { sessionStorage: Store; localStorage: Store };
    if (browser.sessionStorage.getItem("navigation-fixture")) return;
    browser.sessionStorage.setItem("navigation-fixture", "1");
    browser.localStorage.setItem("coordina_adg_token", state === "expired" ? account.expiredToken : account.token);
    browser.localStorage.setItem("coordina_adg_user", JSON.stringify(account.user));
    browser.localStorage.setItem("coordina_adg_biometric", state === "locked" ? "1" : "0");
  }, { account, state });
}

async function expectDestination(page: Page, destination: typeof destinations[number]) {
  await expect.poll(() => {
    const url = new URL(page.url());
    return url.pathname + url.search;
  }).toBe(destination.path);
  await expect(page.getByText(destination.heading, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(profileGate, { exact: true })).toHaveCount(0);
  await expect(page.getByText(event.name, { exact: true }).first()).toBeVisible();
  if (destination.type === "acta-detail") {
    await expect(page.getByRole("button", { name: "Descargar acta acta-navegacion-ui.pdf", exact: true })).toBeVisible();
    await expect(page.getByText("BORRADOR PRIVADO NO VISIBLE UI")).toHaveCount(0);
  }
}

async function openDestination(
  page: Page, path: string, account: Account, state: "signed-out" | "locked" | "expired",
) {
  if (state !== "signed-out") await savedSession(page, account, state);
  if (state === "expired") {
    const denied = page.waitForResponse(r => r.url().includes("/api/auth/me/teaching-profile") && r.status() === 401);
    await page.goto(path);
    await denied;
    await expect(page.getByText("No se pudieron cargar tus datos docentes.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  } else {
    await page.goto(path);
  }
  await expect(page).toHaveURL(/\/login$/);
}

for (const destination of destinations) {
  for (const state of ["signed-out", "locked", "expired"] as const) {
    test(`${destination.type}: ${state} returns to the notice after password login`, async ({ page }) => {
      await openDestination(page, destination.path, accounts.member, state);
      // A rejected password must not consume the pending destination.
      expect((await login(page, accounts.member, "incorrect-password")).status()).toBe(401);
      await expect(page).toHaveURL(/\/login$/);
      expect((await login(page, accounts.member)).status()).toBe(200);
      await expectDestination(page, destination);
      await page.reload();
      if (state === "locked") {
        // Password login does not disable the saved device lock.
        await expect(page).toHaveURL(/\/login$/);
        expect((await login(page, accounts.member)).status()).toBe(200);
      }
      await expectDestination(page, destination);
    });
  }

  for (const state of ["signed-out", "locked", "expired"] as const) {
    test(`${destination.type}: ${state} login return cannot bypass the mandatory teaching profile`, async ({ page }) => {
      await openDestination(page, destination.path, accounts.incomplete, state);
      expect((await login(page, accounts.incomplete)).status()).toBe(200);
      await expect(page).toHaveURL(/\/perfil$/);
      await expect(page.getByText(profileGate, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Guardar datos docentes", exact: true })).toBeVisible();
      // Also verify the API gate, not just a client-side redirect.
      const denied = await page.request.get("/api/events", {
        headers: { Authorization: `Bearer ${accounts.incomplete.token}` },
      });
      expect(denied.status()).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "TEACHING_PROFILE_REQUIRED" });
      await page.goto(destination.path);
      if (state === "locked") {
        // A full document navigation also boots the saved device lock.
        await expect(page).toHaveURL(/\/login$/);
        expect((await login(page, accounts.incomplete)).status()).toBe(200);
      }
      await expect(page).toHaveURL(/\/perfil$/);
      await page.reload();
      if (state === "locked") {
        await expect(page).toHaveURL(/\/login$/);
        expect((await login(page, accounts.incomplete)).status()).toBe(200);
        await expect(page).toHaveURL(/\/perfil$/);
      }
      await expect(page.getByText(profileGate, { exact: true })).toBeVisible();
    });
  }

  test(`${destination.type}: returning as a different account does not grant access`, async ({ page }) => {
    await savedSession(page, accounts.member, "locked");
    await page.goto(destination.path);
    await expect(page).toHaveURL(/\/login$/);
    const targetEndpoint = destination.type === "certificate" ? "/api/me/attendance-certificates"
      : destination.type === "acta-detail" ? `/api/events/${event.id}` : "/api/events";
    const targetLoaded = page.waitForResponse(response =>
      new URL(response.url()).pathname === targetEndpoint &&
      response.status() === (destination.type === "acta-detail" ? 403 : 200),
    );
    expect((await login(page, accounts.outsider)).status()).toBe(200);
    await targetLoaded;
    await expect.poll(() => new URL(page.url()).pathname).toBe(destination.path);
    await expect(page.getByText(destination.heading, { exact: true }).first()).toBeVisible();
    const headers = { Authorization: `Bearer ${accounts.outsider.token}` };
    const deniedEvent = await page.request.get(`/api/events/${event.id}`, { headers });
    expect(deniedEvent.status()).toBe(403);
    const deniedMinutes = await page.request.get(`/api/events/${event.id}/minutes`, { headers });
    expect(deniedMinutes.status()).toBe(403);
    const deniedCertificate = await page.request.get(`/api/me/attendance-certificates/${fixtures.notificationCertificateId}/pdf`, { headers });
    expect(deniedCertificate.status()).toBe(404);
    const certificates = await page.request.get("/api/me/attendance-certificates", { headers });
    expect(certificates.status()).toBe(200);
    expect((await certificates.json()).items).toEqual([]);
    await expect(page.getByText(event.name, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Descargar acta acta-navegacion-ui.pdf", exact: true })).toHaveCount(0);
  });
}

for (const target of [
  { kind: "event", type: "event", heading: "Eventos" },
  { kind: "certificate_event", type: "certificate", heading: "Mis certificados" },
]) {
  test(`${target.type}: expired login retains the structured target query`, async ({ page }) => {
    const destination = {
      type: target.type,
      path: notificationPath({ type: target.type, target: { kind: target.kind, id: event.id } }),
      heading: target.heading,
    };
    await openDestination(page, destination.path, accounts.member, "expired");
    expect((await login(page, accounts.member)).status()).toBe(200);
    await expectDestination(page, destination);
  });
}
