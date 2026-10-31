import { parse } from "parse5";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const OFFICIAL_OFFER_URL = "https://www.gobiernodecanarias.org/educacion/web/formacion_profesional/orientacion/oferta_formacion_profesional/";
const exec = promisify(execFile);
const MAX_BYTES = 5 * 1024 * 1024;
export const normalizeOfferText = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/\s+/g, " ").trim();
export const cycleOfferName = (name: string) => normalizeOfferText(name)
  .replace(/^(tecnico superior|tecnico basico|tecnico|titulo profesional basico) en /, "");

export function officialOfferUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== "https:" || !["www.gobiernodecanarias.org", "gobiernodecanarias.org"].includes(url.hostname)
    || url.username || url.password || url.port
    || !["/educacion/", "/cmsgob1/export/sites/educacion/"].some(prefix => url.pathname.startsWith(prefix))) {
    throw new Error("Utiliza una URL HTTPS del portal oficial de Educación del Gobierno de Canarias.");
  }
  url.hash = "";
  return url.href;
}

function yearValue(first: string, last: string) {
  const start = Number(first.length === 2 ? `20${first}` : first);
  const end = Number(last.length === 2 ? `20${last}` : last);
  return end === start + 1 ? `${start}/${end}` : null;
}
export function sourceMatchesYear(url: string, heading: string, year: string): boolean {
  const target = year.match(/^(20\d{2})\s*[/-]\s*(20\d{2}|\d{2})$/);
  if (!target) return false;
  const expected = yearValue(target[1], target[2]);
  if (!expected) return false;
  const path = new URL(url).pathname.match(/curso[\/_-]?(\d{2}|20\d{2})[_/-](\d{2}|20\d{2})(?:[/_.-]|$)/i);
  const title = heading.match(/(?:curso\s*:?\s*)?(20\d{2})\s*[-/–]\s*(20\d{2}|\d{2})/i);
  const declared = [path && yearValue(path[1], path[2]), title && yearValue(title[1], title[2])].filter(Boolean);
  return declared.length > 0 && declared.every(value => value === expected);
}

type HtmlNode = { nodeName: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] };
function htmlDocument(html: string, base: string) {
  const links = new Set<string>();
  const headings: string[] = [];
  const visit = (node: HtmlNode): string => {
    if (["script", "style", "noscript", "svg", "iframe", "object", "template"].includes(node.nodeName)) return "";
    if (node.nodeName === "#text") return node.value ?? "";
    if (node.nodeName === "a") {
      const href = node.attrs?.find(a => a.name === "href")?.value;
      if (href) { try { links.add(officialOfferUrl(new URL(href, base).href)); } catch { /* Ignore off-portal links. */ } }
    }
    const text = (node.childNodes ?? []).map(visit).join(" ");
    if (/^h[1-4]$/.test(node.nodeName)) headings.push(text);
    return ["tr", "p", "div", "li"].includes(node.nodeName) ? `\n${text}\n` : text;
  };
  const text = visit(parse(html) as HtmlNode).replace(/[ \t]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
  return { text, heading: headings.join(" ").slice(0, 5000), links: [...links] };
}

/** A fixed official host allowlist is enforced again on every redirect. No
 * user URL, redirect, credential, or non-education resource can escape it. */
export async function readOfficialOffer(input: string) {
  let url = officialOfferUrl(input);
  const signal = AbortSignal.timeout(20_000);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(url, { redirect: "manual", signal, headers: { Accept: "text/html,application/pdf" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      if (redirect === 3 || !response.headers.get("location")) throw new Error("Demasiadas redirecciones en la fuente oficial.");
      url = officialOfferUrl(new URL(response.headers.get("location")!, url).href);
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`La fuente oficial no está disponible (HTTP ${response.status}).`);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) throw new Error("La fuente supera el límite de 5 MB.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const bytes = Buffer.concat(chunks);
    if (bytes.subarray(0, 5).toString() === "%PDF-") {
      const dir = await mkdtemp(join(tmpdir(), "coordina-offer-"));
      try {
        const path = join(dir, "oferta.pdf"); await writeFile(path, bytes);
        const { stdout } = await exec("pdftotext", ["-layout", path, "-"], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 });
        if (!stdout.trim()) throw new Error("El PDF no contiene texto legible; no se inventará su oferta.");
        return { url, text: stdout, heading: stdout.slice(0, 2500), links: [] as string[] };
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
    const type = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("La fuente debe ser una página HTML o un PDF oficial.");
    return { url, ...htmlDocument(bytes.toString("utf8"), url) };
  }
  throw new Error("No se pudo leer la fuente oficial.");
}

export async function discoverOfficialOffers(urls: string[], year: string) {
  const sources = new Set<string>();
  const warnings: string[] = [];
  const results = await Promise.allSettled(urls.map(readOfficialOffer));
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      warnings.push(`No se pudo leer ${urls[index]}. Comprueba que la fuente oficial está disponible.`);
      continue;
    }
    const page = result.value;
    const linked = page.links.filter(url => /\.pdf(?:\?|$)/i.test(url) && sourceMatchesYear(url, "", year));
    for (const url of linked) sources.add(url);
    if (sourceMatchesYear(page.url, page.heading, year)) {
      if (linked.length === 0) sources.add(page.url);
    } else if (linked.length === 0) {
      warnings.push(`La fuente ${page.url} no identifica el curso ${year}. Añade el enlace oficial de ese curso; no se usará una oferta de otro año.`);
    }
  }
  if (sources.size > 30) throw new Error("Hay más de 30 documentos. Utiliza enlaces oficiales más específicos.");
  return { sources: [...sources], warnings };
}
