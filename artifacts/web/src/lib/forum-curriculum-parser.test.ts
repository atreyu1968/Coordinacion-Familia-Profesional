import { describe, expect, it } from "vitest";
import {
  EXPECTED_COLUMNS,
  parseCurriculumJson,
  parseCurriculumRows,
  parseNormativeSource,
} from "./forum-curriculum-parser";

const SRC =
  "Real Decreto 1584/2011, de 4 de noviembre, anexo I; texto consolidado. https://www.boe.es/buscar/act.php?id=BOE-A-2011-19533 | Consulta: 31/10/2026.";
const summary = [["Familia profesional", "Administración y Gestión"]];

const row = (o: Partial<Record<(typeof EXPECTED_COLUMNS)[number], string>>) =>
  EXPECTED_COLUMNS.map((c) =>
    o[c] ??
    ({
      Ciclo: "Técnico Superior en Administración y Finanzas",
      Nivel: "Grado Superior",
      "Código del módulo": "0651",
      Módulo: "Comunicación y atención al cliente",
      "Código RA": "RA1",
      "Descripción RA": "Caracteriza técnicas.",
      "Código CE": "1.a",
      "Descripción CE": "Se han identificado.",
      "Fuente normativa": SRC,
      "Versión curricular": "Título de 2011",
      Territorio: "Estatal (España) · aplicación en Canarias",
    } as Record<string, string>)[c] ??
    "",
  );

const parse = (rows: string[][], s: unknown[][] | null = summary) =>
  parseCurriculumRows([[...EXPECTED_COLUMNS], ...rows], { workbook: "libro.xlsx", summary: s });

describe("parseNormativeSource", () => {
  it("extracts title and BOE url, dropping the Consulta suffix", () => {
    const r = parseNormativeSource(SRC);
    expect(r.sourceUrl).toBe("https://www.boe.es/buscar/act.php?id=BOE-A-2011-19533");
    expect(r.sourceTitle).toBe("Real Decreto 1584/2011, de 4 de noviembre, anexo I; texto consolidado");
  });
  it("ignores non-official urls", () => {
    expect(parseNormativeSource("Decreto https://example.com/x | Consulta").sourceUrl).toBe("");
  });
});

describe("parseCurriculumRows", () => {
  it("groups RA/CE preserving codes and appearance order", () => {
    const res = parse([
      row({ "Código CE": "1.a" }),
      row({ "Código CE": "1.b" }),
      row({ "Código RA": "RA2", "Descripción RA": "Otro.", "Código CE": "2.a" }),
    ]);
    expect(res.candidates).toHaveLength(1);
    const c = res.candidates[0];
    expect(c.outcomes.map((o) => [o.code, o.order])).toEqual([["RA1", 1], ["RA2", 2]]);
    expect(c.outcomes[0].criteria.map((x) => [x.code, x.order])).toEqual([["1.a", 1], ["1.b", 2]]);
    expect(c.officialCode).toBe("0651");
    expect(c.territory).toContain("Canarias");
    expect(res.familyVerified).toBe(true);
  });

  it("never merges same module name across cycles", () => {
    const res = parse([row({}), row({ Ciclo: "Técnico en Gestión Administrativa" })]);
    expect(res.candidates).toHaveLength(2);
  });

  it("rejects RA with different description", () => {
    expect(() => parse([row({}), row({ "Descripción RA": "Distinta", "Código CE": "1.b" })])).toThrow(/otra descripción/);
  });

  it("rejects duplicated CE", () => {
    expect(() => parse([row({}), row({})])).toThrow(/duplicado/);
  });
  it("blocks a module with duplicate identities without discarding other reviewed modules", () => {
    const res = parse([row({}), row({}), row({ Módulo: "Otro módulo", "Código del módulo": "9999" })]);
    expect(res.candidates.map(c => c.moduleName)).toEqual(["Otro módulo"]);
    expect(res.warnings[0]).toContain("duplicado");
    expect(res.warnings[0]).toContain("No se propone actualizar");
  });

  it("rejects incomplete rows", () => {
    expect(() => parse([row({ "Descripción CE": "" })])).toThrow(/Fila 2 incompleta/);
  });
  it("keeps real workbook tutorial and historical rows out of update proposals", () => {
    const res = parse([row({}), row({
      Módulo: "Tutoría", "Código del módulo": "", "Código RA": "", "Descripción RA": "",
      "Código CE": "", "Descripción CE": "", Observaciones: "Sin RA/CE propios; no inventar resultados.",
    })]);
    expect(res.candidates).toHaveLength(1);
    expect(res.warnings[0]).toContain("no se propone actualizarlo");
  });

  it("rejects other families and warns when family is unknown", () => {
    expect(() => parse([row({})], [["Familia profesional", "Informática"]])).toThrow(/Informática/);
    const res = parse([row({})], null);
    expect(res.familyVerified).toBe(false);
    expect(res.warnings[0]).toMatch(/familia/);
  });

  it("requires expected columns", () => {
    expect(() => parseCurriculumRows([["Ciclo"]], { workbook: "x.xlsx" })).toThrow(/Faltan columnas/);
  });
});

describe("parseCurriculumJson", () => {
  const base = {
    family: "Administración y Gestión",
    moduleName: "M",
    cycleName: "C",
    workbook: "w",
    officialCode: "0651",
    sourceTitle: "RD",
    sourceUrl: "https://www.boe.es/x",
    curriculumVersion: "v",
    territory: "Canarias",
    outcomes: [{ code: "RA1", description: "d", order: 1, criteria: [{ code: "1.a", description: "c", order: 1 }] }],
  };
  it("accepts normalized input", () => {
    expect(parseCurriculumJson(JSON.stringify(base), "f.json").candidates[0].outcomes[0].code).toBe("RA1");
  });
  it("rejects other family and duplicated CE", () => {
    expect(() => parseCurriculumJson(JSON.stringify({ ...base, family: "Otra" }), "f")).toThrow(/family/);
    const dup = { ...base, outcomes: [{ ...base.outcomes[0], criteria: [base.outcomes[0].criteria[0], base.outcomes[0].criteria[0]] }] };
    expect(() => parseCurriculumJson(JSON.stringify(dup), "f")).toThrow(/duplicado/);
  });
});
