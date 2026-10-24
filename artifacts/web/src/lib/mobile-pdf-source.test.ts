import { Blob } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPdfBytes, resolvePdfSource } from "../../../movil/lib/pdf-source";

const origin = "https://app.example.test";
afterEach(() => vi.unstubAllGlobals());

describe("mobile web PDF source", () => {
  it("allows only the app origin, its own blobs and the configured API", () => {
    expect(resolvePdfSource("/api/files/7", origin).href).toBe(`${origin}/api/files/7`);
    expect(resolvePdfSource(`blob:${origin}/pdf-7`, origin).protocol).toBe("blob:");
    expect(resolvePdfSource("https://api.example.test/api/files/7", origin, "api.example.test").origin)
      .toBe("https://api.example.test");
  });

  it.each([
    "https://outside.example.test/file.pdf", "javascript:alert(1)",
    "data:application/pdf;base64,JVBERg==", "blob:https://outside.example.test/id",
    "https://user:password@app.example.test/file.pdf",
    "https://app.example.test.outside.example.test/file.pdf",
  ])("rejects untrusted sources without making any request: %s", async (uri) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadPdfBytes(uri, origin, undefined, "fixture-token")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches protected PDFs with authorization and validates the bytes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), blob: async () => new Blob(["%PDF-1.7\nfixture"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    const abort = new AbortController();
    const bytes = await loadPdfBytes("/api/files/7", origin, undefined, "fixture-token", abort.signal);
    expect(bytes.byteLength).toBeGreaterThan(5);
    expect(fetchMock).toHaveBeenCalledWith(`${origin}/api/files/7`, {
      headers: { Authorization: "Bearer fixture-token" }, signal: abort.signal,
    });
  });

  it("does not attach a bearer token when reading a local blob", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), blob: async () => new Blob(["%PDF-1.7\nfixture"]),
    });
    vi.stubGlobal("fetch", fetchMock);
    await loadPdfBytes(`blob:${origin}/file`, origin, undefined, "fixture-token");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it.each([401, 403])("reports access denial (%s) without reading the body", async (status) => {
    const blob = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, blob }));
    await expect(loadPdfBytes("/api/files/7", origin, undefined, null)).rejects.toThrow("No tienes permiso");
    expect(blob).not.toHaveBeenCalled();
  });

  it("rejects non-PDF responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), blob: async () => new Blob(["<html>login</html>"]),
    }));
    await expect(loadPdfBytes("/api/files/7", origin, undefined, null)).rejects.toThrow("PDF válido");
  });

  it("rejects declared oversized PDFs before loading their body", async () => {
    const blob = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, headers: new Headers({ "Content-Length": String(51 * 1024 * 1024) }), blob,
    }));
    await expect(loadPdfBytes("/api/files/7", origin, undefined, null)).rejects.toThrow("50 MB");
    expect(blob).not.toHaveBeenCalled();
  });
});
