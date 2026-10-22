import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeGoogleCode } from "../src/lib/coordinatorMailGmail";

const config = {
  clientId: "test-client.apps.googleusercontent.com",
  clientSecret: "test-client-secret",
  redirectUri: "https://coordinacionfp.org/api/coordinator-mail/gmail/callback",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Google OAuth code exchange", () => {
  it("accepts an access token when Google omits a new refresh token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ access_token: "access-token", expires_in: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    const result = await exchangeGoogleCode("one-time-code", "pkce-verifier", config);

    expect(result.accessToken).toBe("access-token");
    expect(result.refreshToken).toBeNull();
  });

  it("rejects token responses without an access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "invalid_grant" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    )));

    await expect(exchangeGoogleCode("one-time-code", "pkce-verifier", config))
      .rejects.toThrow("Google no autorizó la conexión");
  });
});
