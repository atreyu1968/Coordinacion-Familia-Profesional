import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPublicLinkAddress, linkCheckUpdate, probeWikiLink } from "../src/lib/wikiLinkProbe";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));

type Reply = { status: number; location?: string };
let replies: Reply[];
beforeEach(() => {
  vi.clearAllMocks();
  replies = [{ status: 200 }];
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  mocks.request.mockImplementation((_url, options, receive) => {
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => {
      const reply = replies.shift();
      if (!reply) throw new Error("Unexpected extra request");
      receive({ statusCode: reply.status, headers: { location: reply.location }, destroy: vi.fn() });
    };
    // Verify the socket uses the checked address, not another DNS resolution.
    options.lookup("ignored", {}, (_err: unknown, address: string) => expect(address).toBe("8.8.8.8"));
    return request;
  });
});

describe("safe, bounded official-link probing", () => {
  it.each(["127.0.0.1", "10.0.0.2", "169.254.169.254", "172.16.1.1", "192.168.1.1",
    "100.100.100.200", "0.0.0.0", "224.0.0.1", "::1", "::ffff:127.0.0.1",
    "fe80::1", "fc00::1", "2001:db8::1", "2002:7f00:1::"])("rejects %s", (address) => {
    expect(isPublicLinkAddress(address)).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("allows public %s", (address) => {
    expect(isPublicLinkAddress(address)).toBe(true);
  });
  it.each([[200, "healthy"], [404, "absent"], [410, "absent"], [403, "blocked"],
    [401, "blocked"], [451, "blocked"], [429, "temporary"], [503, "temporary"]])(
    "classifies HTTP %s as %s", async (status, kind) => {
      replies = [{ status: Number(status) }];
      expect(await probeWikiLink("https://www.boe.es/example")).toMatchObject({ kind, httpStatus: status });
    });
  it("falls back to GET without consuming a body when HEAD is unsupported", async () => {
    replies = [{ status: 405 }, { status: 200 }];
    expect((await probeWikiLink("https://www.boe.es/example")).kind).toBe("healthy");
    expect(mocks.request.mock.calls.map((call) => call[1].method)).toEqual(["HEAD", "GET"]);
  });
  it("records relative redirects without replacing the original URL", async () => {
    replies = [{ status: 302, location: "/new" }, { status: 200 }];
    expect(await probeWikiLink("https://www.boe.es/old")).toEqual({
      kind: "redirected", httpStatus: 200, redirectUrl: "https://www.boe.es/new",
    });
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });
  it("never connects to a redirect's private destination", async () => {
    replies = [{ status: 301, location: "http://localhost/private" }];
    mocks.lookup.mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    expect((await probeWikiLink("https://www.boe.es/old")).kind).toBe("temporary");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("rejects mixed public/private DNS answers", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }]);
    expect((await probeWikiLink("https://www.boe.es/old")).kind).toBe("temporary");
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each(["file:///etc/passwd", "http://example.org:8080/", "https://user:pass@example.org/"])(
    "does not request unsafe URL %s", async (url) => {
      expect((await probeWikiLink(url)).kind).toBe("temporary");
      expect(mocks.request).not.toHaveBeenCalled();
    });
  it("bounds redirect loops", async () => {
    replies = Array.from({ length: 6 }, () => ({ status: 302, location: "/loop" }));
    expect((await probeWikiLink("https://www.boe.es/loop")).kind).toBe("temporary");
    expect(mocks.request).toHaveBeenCalledTimes(6);
  });
  it("bounds a stalled DNS lookup", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    try {
      mocks.lookup.mockReturnValue(new Promise(() => {}));
      const result = probeWikiLink("https://www.boe.es/");
      expect(timeout).toHaveBeenCalledWith(15_000);
      controller.abort();
      expect((await result).kind).toBe("temporary");
    } finally { timeout.mockRestore(); }
  });
  it("treats DNS/TLS/network errors as temporary rather than disappearance", async () => {
    mocks.lookup.mockRejectedValue(new Error("ENOTFOUND"));
    expect((await probeWikiLink("https://www.boe.es/")).kind).toBe("temporary");
  });
});

describe("persistent retry policy", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  const absent = { kind: "absent", httpStatus: 404, redirectUrl: null } as const;
  it("requires three spaced absent responses, then limits retries to weekly", () => {
    let previous = { missingCount: 0, failureCount: 0 };
    for (const [status, hours] of [["temporary", 6], ["temporary", 24], ["missing", 168], ["missing", 168]] as const) {
      const updated = linkCheckUpdate(absent, previous, now);
      expect(updated.checkStatus).toBe(status);
      expect(updated.nextCheckAt.getTime() - now.getTime()).toBe(hours * 3_600_000);
      previous = updated;
    }
  });
  it("resets disappearance evidence on a block or transient failure", () => {
    for (const kind of ["blocked", "temporary"] as const) {
      const updated = linkCheckUpdate({ kind, httpStatus: 403, redirectUrl: null },
        { missingCount: 2, failureCount: 2 }, now);
      expect(updated.missingCount).toBe(0);
      expect(updated.checkStatus).toBe(kind);
    }
  });
  it("recovers automatically without touching title, URL, or content", () => {
    const updated = linkCheckUpdate({ kind: "healthy", httpStatus: 200, redirectUrl: null },
      { missingCount: 3, failureCount: 3 }, now);
    expect(updated).toMatchObject({ checkStatus: "healthy", missingCount: 0, failureCount: 0, redirectUrl: null });
    expect(Object.keys(updated).sort()).toEqual([
      "checkStatus", "checkedAt", "failureCount", "httpStatus", "missingCount", "nextCheckAt", "redirectUrl",
    ]);
  });
});
