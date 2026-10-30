import { afterEach, describe, expect, it } from "vitest";
import {
  AUTH_SESSION_NOTICE_KEY,
  getStoredAuthSessionNotice,
} from "./auth";

afterEach(() => localStorage.clear());

describe("session notice storage", () => {
  it("removes an old object-coercion notice instead of showing [object Object]", () => {
    localStorage.setItem(AUTH_SESSION_NOTICE_KEY, "[object Object]");

    expect(getStoredAuthSessionNotice()).toBeNull();
    expect(localStorage.getItem(AUTH_SESSION_NOTICE_KEY)).toBeNull();
  });

  it("recovers a useful message from a previously serialized notice object", () => {
    localStorage.setItem(
      AUTH_SESSION_NOTICE_KEY,
      JSON.stringify({ message: "La aplicación se ha actualizado." }),
    );

    expect(getStoredAuthSessionNotice()).toBe("La aplicación se ha actualizado.");
  });

  it("preserves an ordinary session notice", () => {
    localStorage.setItem(AUTH_SESSION_NOTICE_KEY, "Tu sesión se ha cerrado.");

    expect(getStoredAuthSessionNotice()).toBe("Tu sesión se ha cerrado.");
  });
});
