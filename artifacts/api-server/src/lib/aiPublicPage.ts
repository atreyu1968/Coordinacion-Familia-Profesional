import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { parse } from "parse5";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 8_000;
const TOTAL_TIMEOUT_MS = 20_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);

export class PublicPageOmittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicPageOmittedError";
  }
}

export class PublicPageReadError extends Error {
  constructor() {
    super("No se pudo leer la página pública; vuelve a actualizar el índice.");
    this.name = "PublicPageReadError";
  }
}

type ResolvedAddress = { address: string; family: number };
type PageResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer };
type PageDependencies = {
  resolve: (hostname: string) => Promise<ResolvedAddress[]>;
  request: (url: URL, address: ResolvedAddress, signal?: AbortSignal) => Promise<PageResponse>;
};
type HtmlNode = { nodeName: string; value?: string; childNodes?: HtmlNode[] };

const ipv4ToNumber = (address: string) => address.split(".").reduce((value, octet) => (value * 256 + Number(octet)) >>> 0, 0);
function inIpv4Range(address: string, network: string, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask);
}
function isPublicIpv4(address: string) {
  if (isIP(address) !== 4) return false;
  const blocked: Array<[string, number]> = [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24],
    ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
    ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
  ];
  return !blocked.some(([network, prefix]) => inIpv4Range(address, network, prefix));
}

function ipv6ToBigInt(address: string): bigint {
  let normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const lastColon = normalized.lastIndexOf(":");
    const ipv4 = normalized.slice(lastColon + 1);
    if (isIP(ipv4) !== 4) return -1n;
    const value = ipv4ToNumber(ipv4);
    normalized = `${normalized.slice(0, lastColon)}:${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return -1n;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[a-f0-9]{1,4}$/.test(group))) return -1n;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

const inIpv6Range = (address: bigint, network: bigint, prefix: bigint) =>
  (address & (((1n << 128n) - 1n) ^ ((1n << (128n - prefix)) - 1n))) === network;

function isPublicIpv6(address: string) {
  if (isIP(address) !== 6 || address.includes("%")) return false;
  const value = ipv6ToBigInt(address);
  if (value < 0n || !inIpv6Range(value, 0x20000000000000000000000000000000n, 3n)) return false;
  // IETF special-use, documentation, and 6to4 ranges are not treated as public.
  return ![
    [0x20010000000000000000000000000000n, 23n],
    [0x20010db8000000000000000000000000n, 32n],
    [0x2002n << 112n, 16n],
    [0x3fff0000000000000000000000000000n, 20n],
  ].some(([network, prefix]) => inIpv6Range(value, network as bigint, prefix as bigint));
}

export function isPublicAddress(address: string) {
  return isIP(address) === 4 ? isPublicIpv4(address) : isPublicIpv6(address);
}

function validatePageUrl(value: string | URL): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new PublicPageOmittedError("El enlace no contiene una dirección pública válida."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      url.port && url.port !== (url.protocol === "http:" ? "80" : "443")) {
    throw new PublicPageOmittedError("El enlace usa un protocolo o destino no permitido.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".onion"].some(suffix => hostname.endsWith(suffix))) {
    throw new PublicPageOmittedError("El enlace apunta a un destino local o no público.");
  }
  url.hash = "";
  return url;
}

async function resolvePublicAddress(url: URL, resolve: PageDependencies["resolve"]): Promise<ResolvedAddress> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const ipFamily = isIP(hostname);
  const addresses = ipFamily
    ? [{ address: hostname, family: ipFamily }]
    : await resolve(hostname).catch(() => []);
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
    throw new PublicPageOmittedError("El enlace apunta a una dirección privada o no pública.");
  }
  return addresses[0];
}

async function resolveDns(hostname: string): Promise<ResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map(item => ({ address: item.address, family: item.family }));
}

async function requestPinnedPage(url: URL, address: ResolvedAddress, signal?: AbortSignal): Promise<PageResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: "GET",
      headers: {
        Accept: "text/html, application/xhtml+xml, text/plain",
        "Accept-Encoding": "identity",
        "User-Agent": "CoordinaADG-AI-Knowledge/1.0",
      },
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      timeout: REQUEST_TIMEOUT_MS,
      signal,
    }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_PAGE_BYTES) {
          request.destroy(new PublicPageOmittedError("La página supera el límite de 2 MB."));
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new PublicPageReadError()));
    request.on("error", reject);
    request.end();
  });
}

const defaultDependencies: PageDependencies = { resolve: resolveDns, request: requestPinnedPage };
const header = (headers: PageResponse["headers"], name: string) => {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};
async function withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new PublicPageReadError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PublicPageReadError()), remaining); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pageText(html: string) {
  const ignored = new Set(["script", "style", "noscript", "svg", "template", "iframe", "object"]);
  const visit = (node: HtmlNode): string => {
    if (ignored.has(node.nodeName)) return "";
    if (node.nodeName === "#text") return node.value ?? "";
    return (node.childNodes ?? []).map(visit).join(" ");
  };
  return visit(parse(html) as HtmlNode).replace(/\s+/g, " ").trim();
}

export async function readPublicPage(
  input: string,
  dependencies: PageDependencies = defaultDependencies,
): Promise<string> {
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let current = validatePageUrl(input);
  for (let redirectCount = 0; ; redirectCount += 1) {
    if (Date.now() >= deadline) throw new PublicPageReadError();
    const address = await withDeadline(resolvePublicAddress(current, dependencies.resolve), deadline);
    const requestController = new AbortController();
    let response: PageResponse;
    try {
      response = await withDeadline(dependencies.request(current, address, requestController.signal), deadline);
    } catch (error) {
      requestController.abort();
      throw error;
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirectCount >= MAX_REDIRECTS) throw new PublicPageOmittedError("La página tiene demasiadas redirecciones.");
      const location = header(response.headers, "location");
      if (!location) throw new PublicPageReadError();
      try { current = validatePageUrl(new URL(location, current)); }
      catch (error) {
        if (error instanceof PublicPageOmittedError) throw error;
        throw new PublicPageOmittedError("La redirección no contiene una dirección pública válida.");
      }
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new PublicPageReadError();
    if (response.body.length > MAX_PAGE_BYTES) throw new PublicPageOmittedError("La página supera el límite de 2 MB.");
    const contentEncoding = header(response.headers, "content-encoding");
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      throw new PublicPageOmittedError("La página usa una compresión no admitida.");
    }
    const contentType = header(response.headers, "content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!contentType || !(HTML_TYPES.has(contentType) || contentType === "text/plain")) {
      throw new PublicPageOmittedError("El tipo de contenido de la página no está admitido.");
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(response.body);
    const text = HTML_TYPES.has(contentType) ? pageText(decoded) : decoded.replace(/\s+/g, " ").trim();
    if (!text) throw new PublicPageOmittedError("La página no contiene texto legible.");
    return text;
  }
}
