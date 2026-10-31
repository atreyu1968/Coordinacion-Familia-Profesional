import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { discoverOfficialOffers, officialOfferUrl, readOfficialOffer, sourceMatchesYear } from "../src/lib/trainingOfferOfficial";
import { readOfferContext, sealOfferPreview, validateOfferCandidates, type OfferContext } from "../src/lib/trainingOfferAi";

const base = "https://www.gobiernodecanarias.org/educacion/oferta/";
const pdf = "https://www.gobiernodecanarias.org/cmsgob1/export/sites/educacion/curso25_26/oferta.pdf";
const context: OfferContext = { kind: "context", contextId: "fixture", ownerId: 10,
  schoolYear: "2025/2026", family: "Administración y Gestión", sources: [pdf],
  centers: [{ id: 1, code: "35000001", name: "Centro de ensayo" }],
  cycles: [{ id: 2, name: "Técnico en Gestión Administrativa", level: "Grado Medio" },
    { id: 3, name: "Técnico Superior en Administración y Finanzas", level: "Grado Superior" }] };
afterEach(() => vi.unstubAllGlobals());

describe("official sources and active year", () => {
  it.each(["http://www.gobiernodecanarias.org/educacion/oferta", "https://www.gobiernodecanarias.org.evil.test/educacion/",
    "https://attacker.test/educacion/", "https://user:secret@www.gobiernodecanarias.org/educacion/",
    "https://www.gobiernodecanarias.org:8443/educacion/", "https://www.gobiernodecanarias.org/educacion/../private/"])(
    "rejects a non-official education URL", url => expect(() => officialOfferUrl(url)).toThrow());
  it("requires explicit matching years; never substitutes the newest year", () => {
    expect(sourceMatchesYear(base, "Oferta Curso 2025-2026", "2025/2026")).toBe(true);
    expect(sourceMatchesYear(pdf, "", "2025/26")).toBe(true);
    expect(sourceMatchesYear(pdf, "Curso 2026-2027", "2025/2026")).toBe(false);
    expect(sourceMatchesYear(base, "Enseñanzas del curso actual", "2025/2026")).toBe(false);
    expect(sourceMatchesYear(`${base}?curso25_26/`, "", "2025/2026")).toBe(false);
    expect(sourceMatchesYear(base, "Curso 2026-2027", "2025/2026")).toBe(false);
  });
  it("follows only official redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(readOfficialOffer(base)).rejects.toThrow("portal oficial");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("discovers only PDFs of the requested year, preserving mismatch warnings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(
      `<h1>Oferta Curso 2026-2027</h1><a href="${pdf}">Anterior</a><a href="${pdf.replace("25_26", "26_27")}">Actual</a>`,
      { headers: { "content-type": "text/html; charset=utf-8" } }))));
    expect((await discoverOfficialOffers([base], "2025/2026")).sources).toEqual([pdf]);
    const mismatch = await discoverOfficialOffers([base], "2024/2025");
    expect(mismatch.sources).toEqual([]);
    expect(mismatch.warnings[0]).toContain("2024/2025");
  });
  it("extracts actual PDF text and reports its year", async () => {
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Curso 2025-2026\n35000001 Gestion Administrativa", { font, size: 12, x: 40, y: 700, lineHeight: 20 });
    const bytes = await doc.save();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf" } })));
    const source = await readOfficialOffer(pdf);
    expect(source.text).toContain("35000001");
    expect(sourceMatchesYear(source.url, source.heading, context.schoolYear)).toBe(true);
  });
});

describe("evidence validation and proposal ownership", () => {
  const evidence = "35000001 Centro de ensayo: Gestión Administrativa";
  it("accepts real catalog matches, deduplicates rows and rejects invented evidence and foreign IDs", () => {
    const valid = { centerCode: "35000001", cycleId: 2, evidence };
    const result = validateOfferCandidates({ offers: [valid, valid, { ...valid, cycleId: 9999 },
      { ...valid, centerCode: "35000002" }, { ...valid, evidence: "35000001 Gestión Administrativa inventada" }] },
    evidence, context, pdf);
    expect(result.rows).toHaveLength(1);
    expect(result.rejected).toBe(3);
    expect(result.rows[0]).toMatchObject({ centerId: 1, cycleId: 2, sourceUrl: pdf });
  });
  it("rejects snippets mixing two centers or unregistered combined qualifications", () => {
    for (const quote of [evidence + " 35000002 Otro centro", evidence + " y Administración y Finanzas"]) {
      expect(validateOfferCandidates({ offers: [{ centerCode: "35000001", cycleId: 2, evidence: quote }] },
        quote, context, pdf).rows).toHaveLength(0);
    }
  });
  it("rejects another owner, a modified token and an expired proposal", () => {
    const token = sealOfferPreview(context);
    expect(readOfferContext(token, 10)).toMatchObject({ contextId: "fixture" });
    expect(() => readOfferContext(token, 11)).toThrow("no pertenece");
    const parts = token.split("."); parts[1] = Buffer.from('{"ownerId":11}').toString("base64url");
    expect(() => readOfferContext(parts.join("."), 11)).toThrow("caducado");
    const expired = sealOfferPreview({ ...context, iat: Math.floor(Date.now() / 1000) - 3600 });
    expect(() => readOfferContext(expired, 10)).toThrow("caducado");
  });
});
