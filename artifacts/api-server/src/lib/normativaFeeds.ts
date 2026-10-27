import { XMLParser } from "fast-xml-parser";
import { parse } from "parse5";

export type Publication = { source: "BOE" | "BOC"; officialId: string; title: string; url: string; publishedAt: string; textUrl: string };
type Node = { nodeName: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: Node[] };
function nodes(root: Node): Node[] { return [root, ...(root.childNodes ?? []).flatMap(nodes)]; }
function attr(n: Node, name: string) { return n.attrs?.find((a) => a.name === name)?.value ?? ""; }
function text(n: Node): string { return n.nodeName === "#text" ? n.value ?? "" : (n.childNodes ?? []).map(text).join(" "); }
export function plainText(html: string): string {
  return text(parse(html) as Node).replace(/\s+/g, " ").trim();
}
export const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const adg = /administracion y gestion|gestion administrativa|administracion y finanzas|asistencia a la direccion|servicios administrativos|informatica de oficina/;
const fp = /formacion profesional|sistema de fp|fp adaptada|titulos? de tecnico|ciclos? formativos?/;
const otherFamily = /familia(?:s)? profesional(?:es)? (?:de )?(?:informatica|sanidad|electricidad|electronica|hosteleria|turismo|comercio|marketing|agraria|maritimo|imagen|sonido|quimica|seguridad|transporte|mantenimiento|fabricacion|energia|agua|textil|madera|edificacion|actividades fisicas|servicios socioculturales|artes graficas|industrias alimentarias)/;
// Fields taught in Administración y Gestión that can be changed by rules
// whose title does not mention FP: tax/accounting, employment, business,
// commercial activity, administrative procedure, and digital records.
const adgIndirect = /\b(?:contabilidad|contable|fiscalidad|tributari[oa]s?|impuesto (?:sobre|de) sociedades|iva|igic|factura(?:cion|s)? electronica|verifactu|nominas?|cotizacion(?:es)?|seguridad social|relaciones laborales|contratos? de trabajo|registro mercantil|sociedades? mercantiles|contratacion publica|procedimiento administrativo|administracion electronica|firma electronica|proteccion de datos|gestion documental|recursos humanos|marketing|actividad comercial|operaciones comerciales|gestion empresarial|emprendimiento|prevencion de riesgos laborales)\b/;

export function isCandidate(title: string, knownTitles: string[] = []): boolean {
  const t = normalize(title);
  // A directorate's name can mention FP in a personnel appointment: it is not
  // a change to FP rules. Do not confuse these routine notices with legislation.
  if (/por la que se (?:resuelve|convoca|dispone|anuncia).*(?:libre designacion|nombramiento|provision.*puestos? de trabajo)/.test(t)) return false;
  return adg.test(t) || adgIndirect.test(t) || fp.test(t) || knownTitles.some((known) => {
    const reference = normalize(known).match(/(?:real decreto|decreto|ley organica|orden)\s+(?:[a-z]+\/)?\d+\/\d{4}/)?.[0];
    return reference != null && t.includes(reference);
  });
}
export function classify(title: string, fullText: string | null) {
  const titleText = normalize(title);
  const t = normalize(`${title} ${fullText ?? ""}`);
  if (adg.test(t)) return { relevance: "adg", reason: "Contiene referencias a Administración y Gestión o sus títulos. Revisar artículos y anexos; no acredita vigencia." };
  if (fullText === null) return { relevance: "uncertain", reason: "No se pudo consultar el texto completo. La aplicabilidad requiere comprobación manual." };
  if (adgIndirect.test(t)) return { relevance: "adg", reason: "Posible impacto indirecto en materias profesionales de Administración y Gestión (fiscalidad, contabilidad, empleo, empresa o gestión digital). Revisa el alcance en Canarias; no acredita vigencia." };
  if (/varios? titulos|varias familias|diversas familias|anexos no concluyentes/.test(`${titleText} ${normalize(fullText)}`) && fp.test(titleText)) {
    return { relevance: "uncertain", reason: "La publicación abarca varios títulos o familias de FP y no se ha podido confirmar si incluye Administración y Gestión. Revisión humana necesaria." };
  }
  if (otherFamily.test(titleText) && !/anexo|varias familias|diversas familias/.test(titleText)) {
    return { relevance: "other", reason: "El texto identifica otra familia y no contiene referencias a materias comunes o profesionales de Administración y Gestión. Se excluye del seguimiento." };
  }
  if (fp.test(titleText) && !/titulo de|titulos de|ciclo formativo|ciclos formativos|familia profesional/.test(titleText)) {
    return { relevance: "general", reason: "Posible normativa común de Formación Profesional. Revisar su alcance para ADG; no acredita vigencia." };
  }
  return { relevance: "other", reason: "No se encuentra relación directa ni indirecta con la familia profesional. Se excluye del seguimiento." };
}

// Only fixed official hosts, no user URLs, redirects, entities, or unbounded bodies.
export async function officialFetch(url: string, accept = "text/html"): Promise<{ status: number; body: string }> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !["www.boe.es", "www.gobiernodecanarias.org"].includes(u.hostname) || u.username || u.password) throw new Error("Fuente no permitida");
  const response = await fetch(url, { headers: { Accept: accept }, redirect: "error", signal: AbortSignal.timeout(20000) });
  if (response.status === 404) return { status: 404, body: "" };
  if (!response.ok) throw new Error(`La fuente devolvió HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Respuesta oficial vacía");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) throw new Error("Respuesta oficial demasiado grande");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return { status: response.status, body: Buffer.concat(chunks).toString("utf8") };
}
export function parseBoe(body: string, day: string): Publication[] {
  const data = JSON.parse(body);
  if (String(data.status?.code) !== "200" || !data.data?.sumario?.diario) throw new Error("Sumario BOE no reconocido");
  const result: Publication[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    if (typeof row.identificador === "string" && /^BOE-A-\d{4}-\d+$/.test(row.identificador) && typeof row.titulo === "string") {
      const id = row.identificador;
      result.push({ source: "BOE", officialId: id, title: row.titulo, publishedAt: day,
        url: `https://www.boe.es/diario_boe/txt.php?id=${id}`, textUrl: `https://www.boe.es/diario_boe/xml.php?id=${id}` });
    }
    for (const child of Object.values(row)) visit(child);
  }
  visit(data.data.sumario.diario);
  return result;
}
export function parseBocArchive(body: string): Map<string, string[]> {
  const days = new Map<string, string[]>();
  for (const n of nodes(parse(body) as Node)) {
    if (n.nodeName !== "a") continue;
    const path = attr(n, "href");
    const date = attr(n, "title").match(/\((\d{4}-\d{2}-\d{2})\)/)?.[1];
    if (!/^\/boc\/\d{4}\/\d+\/index\.html$/.test(path) || !date) continue;
    days.set(date, [...(days.get(date) ?? []), `https://www.gobiernodecanarias.org${path}`]);
  }
  if (days.size === 0) throw new Error("Archivo BOC no reconocido; no se ha adelantado la cobertura");
  return days;
}
export function parseBoc(body: string, day: string): Publication[] {
  const result: Publication[] = [];
  for (const li of nodes(parse(body) as Node).filter((n) => n.nodeName === "li" && attr(n, "class").includes("justificado_boc"))) {
    const anchors = nodes(li).filter((n) => n.nodeName === "a");
    const link = anchors.find((n) => /boc-a-\d{4}-\d+-\d+\.pdf$/i.test(attr(n, "href")) && text(n).trim().length > 15);
    if (!link) continue;
    const pdf = attr(link, "href");
    const id = pdf.match(/boc-a-(\d{4})-(\d+)-(\d+)\.pdf$/i)!;
    const preview = anchors.find((n) => /^\/boc\/\d{4}\/\d+\/\d+\.html$/.test(attr(n, "href")));
    result.push({ source: "BOC", officialId: `BOC-A-${id[1]}-${Number(id[2])}-${Number(id[3])}`,
      title: text(link).replace(/\s+/g, " ").trim(), url: pdf, publishedAt: day,
      textUrl: preview ? `https://www.gobiernodecanarias.org${attr(preview, "href")}` : "" });
  }
  if (!body.includes("BOC-S-") || result.length === 0) throw new Error("Sumario BOC no reconocido");
  return result;
}
export function boeText(body: string): string {
  const xml = new XMLParser({ processEntities: false }).parse(body);
  if (!xml.documento?.texto) throw new Error("Texto BOE no reconocido");
  return JSON.stringify(xml.documento.texto);
}
