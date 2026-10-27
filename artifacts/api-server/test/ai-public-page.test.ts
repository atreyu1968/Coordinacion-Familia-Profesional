import { describe, expect, it, vi } from "vitest";
import { isPublicAddress, PublicPageOmittedError, readPublicPage } from "../src/lib/aiPublicPage";

const publicAddress = [{ address: "93.184.216.34", family: 4 }];
const response = (status: number, headers: Record<string, string> = {}, body = "") => ({
  status, headers, body: Buffer.from(body),
});
const dependencies = (request: (url: URL) => ReturnType<typeof response>, resolve = vi.fn(async () => publicAddress)) => ({
  resolve,
  request: vi.fn(async (url: URL) => request(url)),
});

describe("safe public page reading for AI knowledge", () => {
  it("rejects private, local, reserved and documentation addresses", () => {
    for (const address of [
      "127.0.0.1", "10.4.5.6", "100.64.0.1", "169.254.2.3", "172.20.0.1",
      "192.168.1.2", "198.18.0.1", "203.0.113.8", "224.0.0.1", "::1",
      "fc00::1", "fe80::1", "2001:db8::1", "2002::1",
    ]) expect(isPublicAddress(address), address).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("extracts readable HTML text while ignoring executable and hidden elements", async () => {
    const http = dependencies(() => response(200, { "content-type": "text/html; charset=utf-8" },
      "<html><head><title>Guía</title><script>ignorar este código</script></head><body><h1>Contenido útil</h1><style>oculto</style><p>Texto final</p></body></html>"));
    await expect(readPublicPage("https://example.org/guia", http)).resolves.toBe("Guía Contenido útil Texto final");
    expect(http.resolve).toHaveBeenCalledWith("example.org");
    expect(http.request).toHaveBeenCalledOnce();
  });

  it("blocks IP literals, local names, credentials and nonstandard ports before requesting", async () => {
    const http = dependencies(() => response(200, { "content-type": "text/plain" }, "texto"));
    for (const url of [
      "http://127.0.0.1/", "http://metadata.google.internal/", "https://user:pass@example.org/",
      "https://example.org:8443/",
    ]) await expect(readPublicPage(url, http)).rejects.toBeInstanceOf(PublicPageOmittedError);
    expect(http.request).not.toHaveBeenCalled();
  });

  it("rejects a DNS result set containing any private address", async () => {
    const http = dependencies(() => response(200, { "content-type": "text/plain" }, "texto"),
      vi.fn(async () => [...publicAddress, { address: "10.0.0.8", family: 4 }]));
    await expect(readPublicPage("https://example.org/", http)).rejects.toBeInstanceOf(PublicPageOmittedError);
    expect(http.request).not.toHaveBeenCalled();
  });

  it("revalidates redirects before following them", async () => {
    const http = dependencies(() => response(302, { location: "http://127.0.0.1/admin" }));
    await expect(readPublicPage("https://example.org/", http)).rejects.toBeInstanceOf(PublicPageOmittedError);
    expect(http.request).toHaveBeenCalledOnce();
  });

  it("follows a small safe redirect chain and rejects unsupported or oversized pages", async () => {
    const redirect = dependencies(url => url.pathname === "/start"
      ? response(302, { location: "/final" })
      : response(200, { "content-type": "text/plain" }, "Página pública"));
    await expect(readPublicPage("https://example.org/start", redirect)).resolves.toBe("Página pública");
    expect(redirect.request).toHaveBeenCalledTimes(2);

    const pdf = dependencies(() => response(200, { "content-type": "application/pdf" }, "not parsed"));
    await expect(readPublicPage("https://example.org/file", pdf)).rejects.toBeInstanceOf(PublicPageOmittedError);
    const large = dependencies(() => response(200, { "content-type": "text/plain" }, "x".repeat(2 * 1024 * 1024 + 1)));
    await expect(readPublicPage("https://example.org/large", large)).rejects.toBeInstanceOf(PublicPageOmittedError);
  });

  it("does not follow more than three redirects", async () => {
    const http = dependencies(url => response(302, { location: `${url.pathname}x` }));
    await expect(readPublicPage("https://example.org/", http)).rejects.toBeInstanceOf(PublicPageOmittedError);
    expect(http.request).toHaveBeenCalledTimes(4);
  });
});
