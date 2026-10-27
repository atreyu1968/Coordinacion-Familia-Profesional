import { describe, expect, it } from "vitest";
import { boeText, classify, isCandidate, parseBoc, parseBocArchive, parseBoe, plainText, officialFetch } from "../src/lib/normativaFeeds";

describe("sumarios oficiales y clasificación conservadora", () => {
  it("acepta items BOE anidados, sin confiar en sus URLs", () => {
    const rows = parseBoe(JSON.stringify({ status: { code: "200" }, data: { sumario: { diario: {
      seccion: [{ departamento: { item: { identificador: "BOE-A-2026-1", titulo: "FP", url_html: "https://evil.test" } } }],
    } } } }), "2026-10-27");
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-1");
    expect(() => parseBoe("{}", "2026-10-27")).toThrow();
  });
  it("lee fechas del archivo BOC, incluidos dos boletines el mismo día", () => {
    const archive = parseBocArchive('<a href="/boc/2026/210/index.html" title="BOC (2026-10-21)">uno</a><a href="/boc/2026/211/index.html" title="BOC (2026-10-21)">extra</a>');
    expect(archive.get("2026-10-21")).toHaveLength(2);
    expect(() => parseBocArchive("<html>error</html>")).toThrow();
  });
  it("deduce CVE de BOC desde PDF, decodifica entidades y mantiene el PDF oficial", () => {
    const [row] = parseBoc('BOC-S-2026-210 <li class="justificado_boc"><a href="https://sede.gobiernodecanarias.org/boc/boc-a-2026-210-03641.pdf">RESOLUCIÓN Formación Profesional &amp; ADG</a><a href="/boc/2026/210/3641.html">HTML</a></li>', "2026-10-21");
    expect(row.officialId).toBe("BOC-A-2026-210-3641");
    expect(row.title).toContain("& ADG");
    expect(row.textUrl).toContain("/3641.html");
    expect(row.url).toContain(".pdf");
    expect(() => parseBoc("Error", "2026-10-21")).toThrow();
  });
  it("reconoce modificaciones comunes y títulos conocidos aunque no repitan FP", () => {
    expect(isCandidate("Se modifica el Real Decreto 659/2023", ["Real Decreto 659/2023, de 18 de julio"])).toBe(true);
    expect(isCandidate("Nombramiento de funcionario")).toBe(false);
    expect(isCandidate("Orden por la que se resuelve la provisión por libre designación en la Dirección General de Formación Profesional")).toBe(false);
    expect(isCandidate("Se modifica el título en Informática de Oficina")).toBe(true);
    expect(classify("Ordenación del sistema de Formación Profesional", "Artículos comunes").relevance).toBe("general");
  });
  it("distingue otras familias sin descartar un cambio que incluye ADG en un anexo", () => {
    const title = "Modificación de Formación Profesional de la familia profesional de Informática y Comunicaciones";
    expect(classify(title, "Solo módulos de informática").relevance).toBe("other");
    expect(classify(title, "Anexo: Administración y Gestión").relevance).toBe("adg");
    expect(classify(title, null).relevance).toBe("uncertain");
    expect(classify("Se modifican varios títulos de Formación Profesional", "Anexos no concluyentes").relevance).toBe("uncertain");
  });
  it("extrae texto XML sin resolver entidades externas y rechaza destinos no oficiales", async () => {
    expect(boeText("<documento><texto><p>Administración y Gestión</p></texto></documento>")).toContain("Gestión");
    expect(() => boeText("<error/>")).toThrow();
    expect(plainText("<p>Texto &amp; anexos</p>")).toContain("Texto & anexos");
    await expect(officialFetch("https://example.com")).rejects.toThrow("Fuente no permitida");
  });
});
