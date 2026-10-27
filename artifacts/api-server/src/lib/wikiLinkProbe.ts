import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) denied.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
denied.addSubnet("2001::", 23, "ipv6");
denied.addSubnet("2002::", 16, "ipv6");
denied.addSubnet("2001:db8::", 32, "ipv6");
denied.addSubnet("3fff::", 20, "ipv6");

export function isPublicLinkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !denied.check(address, "ipv4");
  return family === 6 && globalV6.check(address, "ipv6") && !denied.check(address, "ipv6");
}

export type LinkProbe = {
  kind: "healthy" | "temporary" | "blocked" | "redirected" | "absent";
  httpStatus: number | null;
  redirectUrl: string | null;
};

// DNS is resolved once and pinned to the socket, including on every redirect.
// No credentials, cookies, custom ports, local addresses or response bodies.
async function requestHeaders(url: URL, method: string, signal: AbortSignal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && url.port !== (url.protocol === "https:" ? "443" : "80"))) {
    throw new Error("Unsafe link");
  }
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicLinkAddress(address))) {
    throw new Error("Non-public link");
  }
  signal.throwIfAborted();
  const pinned = addresses[0]!;
  return new Promise<{ status: number; location?: string }>((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method, signal, agent: false, family: pinned.family,
      headers: { "User-Agent": "CoordinaADG-LinkChecker/1.0", Accept: "*/*" },
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => {
      resolve({ status: response.statusCode ?? 0, location: response.headers.location });
      response.destroy();
    });
    request.on("error", reject);
    request.end();
  });
}

export async function probeWikiLink(rawUrl: string): Promise<LinkProbe> {
  const signal = AbortSignal.timeout(15_000);
  let redirectUrl: string | null = null;
  const work = async (): Promise<LinkProbe> => {
    try {
      let url = new URL(rawUrl);
      for (let hops = 0; hops <= 5; hops++) {
        let response = await requestHeaders(url, "HEAD", signal);
        if ([405, 501].includes(response.status)) response = await requestHeaders(url, "GET", signal);
        const httpStatus = response.status;
        if ([301, 302, 303, 307, 308].includes(httpStatus)) {
          if (!response.location || hops === 5) return { kind: "temporary", httpStatus, redirectUrl };
          url = new URL(response.location, url);
          redirectUrl = url.href;
          continue;
        }
        const kind = [404, 410].includes(httpStatus) ? "absent"
          : [401, 403, 407, 451].includes(httpStatus) ? "blocked"
          : httpStatus >= 200 && httpStatus < 300 ? (redirectUrl ? "redirected" : "healthy")
          : "temporary";
        return { kind, httpStatus, redirectUrl };
      }
    } catch { /* Network, TLS, DNS and safety errors are never evidence of removal. */ }
    return { kind: "temporary", httpStatus: null, redirectUrl };
  };
  // Also bounds DNS lookups (node's resolver does not accept AbortSignal).
  return Promise.race([
    work(),
    new Promise<LinkProbe>((resolve) => {
      signal.addEventListener("abort", () => resolve({ kind: "temporary", httpStatus: null, redirectUrl }), { once: true });
    }),
  ]);
}

export function linkCheckUpdate(
  result: LinkProbe, previous: { missingCount: number; failureCount: number },
  now = new Date(),
) {
  const missingCount = result.kind === "absent" ? previous.missingCount + 1 : 0;
  const failed = ["absent", "temporary", "blocked"].includes(result.kind);
  const failureCount = failed ? Math.min(previous.failureCount + 1, 3) : 0;
  const checkStatus = result.kind === "absent"
    ? (missingCount >= 3 ? "missing" : "temporary") : result.kind;
  const hours = failed && failureCount === 1 ? 6 : failed && failureCount === 2 ? 24 : 168;
  return {
    checkStatus, checkedAt: now, nextCheckAt: new Date(now.getTime() + hours * 3_600_000),
    httpStatus: result.httpStatus, redirectUrl: result.redirectUrl,
    missingCount: Math.min(missingCount, 3), failureCount,
  };
}
