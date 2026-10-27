import { readFileSync } from "node:fs";
import { fpaCatalogGuide } from "./fp-adapted-catalog";

export type NormativaReference = { title: string; url: string; kind: string; note: string };
export type NormativaSection = { key: string; title: string; description: string; guide?: string[]; references: NormativaReference[] };
export type NormativaCatalog = {
  reviewedAt: string; family: string; scope: string; notice: string; sections: NormativaSection[];
};

export function loadNormativaCatalog(): NormativaCatalog {
  const catalog: NormativaCatalog = JSON.parse(readFileSync(new URL("../data/normativa-fp.json", import.meta.url), "utf8"));
  const keys = new Set<string>();
  const urls = new Set<string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(catalog.reviewedAt) || !catalog.sections.length) {
    throw new Error("Catálogo normativo sin fecha de revisión o secciones.");
  }
  for (const section of catalog.sections) {
    if (keys.has(section.key) || !section.title || !section.references.length) throw new Error("Sección normativa inválida.");
    keys.add(section.key);
    for (const reference of section.references) {
      const url = new URL(reference.url);
      if (url.protocol !== "https:" || url.username || url.password
        || !["www.boe.es", "www.gobiernodecanarias.org", "www.todofp.es"].includes(url.hostname)
        || urls.has(reference.url) || !reference.title || !reference.kind || !reference.note) {
        throw new Error(`Referencia normativa inválida: ${reference.title}`);
      }
      urls.add(reference.url);
    }
  }
  const fpa = catalog.sections.find((section) => section.key === "fp-adaptada");
  if (fpa) fpa.guide = [...(fpa.guide ?? []), ...fpaCatalogGuide()];
  return catalog;
}

export function normativaSectionContent(catalog: NormativaCatalog, section: NormativaSection): string {
  return [
    `Revisión de fuentes: ${catalog.reviewedAt}. Familia: ${catalog.family}.`,
    section.description,
    `> ${catalog.notice}`,
    ...(section.guide ?? []),
    ...section.references.flatMap((reference) => [
      `## ${reference.title}`, `Tipo de referencia: ${reference.kind}.`,
      reference.note, `Fuente oficial: ${reference.url}`, "",
    ]),
  ].join("\n\n");
}

export function normativaIndexContent(
  catalog: NormativaCatalog,
  titles = catalog.sections.map((section) => section.title).sort((a, b) => a.localeCompare(b, "es")),
  count = catalog.sections.reduce((sum, section) => sum + section.references.length, 0),
): string {
  return [
    "## Formación Profesional · España y Canarias",
    catalog.scope,
    `Revisión de fuentes: ${catalog.reviewedAt}. ${count} referencias oficiales organizadas en ${titles.length} apartados.`,
    `> ${catalog.notice}`,
    "## Apartados",
    ...titles.map((title) => `- Normativa · ${title}`),
    "Usa el apartado Normativa o filtra por la etiqueta normativa para localizar las páginas. Cada apartado incluye contexto y enlaces oficiales, que también aparecen como enlaces externos.",
    "## Cómo aplicar las referencias",
    "- Comienza por la Ley Orgánica 3/2022 y el Real Decreto 659/2023.",
    "- Para cada ciclo, combina la norma estatal del título, sus modificaciones y las instrucciones y anexos de Canarias.",
    "- Distingue grado, modalidad, régimen dual, cohorte y curso académico.",
    "- No apliques los currículos del ámbito de gestión del Ministerio como si fueran automáticamente los de Canarias.",
    "- Las normas de planes anteriores se consultan solo cuando resulte aplicable su régimen transitorio.",
    "- La coordinación puede ampliar la recopilación mediante la gestión habitual de Documentación, según sus permisos. La actualización de la aplicación no sobrescribe estas páginas.",
  ].join("\n\n");
}

/** Only a byte-for-byte match to the generated template permits refreshing the index. */
export function isUneditedNormativaIndex(content: string, catalog: NormativaCatalog): boolean {
  const metadata = content.match(/Revisión de fuentes: (\d{4}-\d{2}-\d{2})\. (\d+) referencias oficiales organizadas en (\d+) apartados\./);
  const titles = [...content.matchAll(/^- Normativa · (.+)$/gm)].map((match) => match[1]!);
  if (!metadata || titles.length !== Number(metadata[3]) || !titles.every((title) =>
    catalog.sections.some((section) => section.title === title))) return false;
  return content === normativaIndexContent({ ...catalog, reviewedAt: metadata[1]! }, titles, Number(metadata[2]));
}
