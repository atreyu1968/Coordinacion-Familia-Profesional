import { describe, expect, it } from "vitest";
import type { ForumCollaborationTracking, ForumTrackingModule } from "@workspace/api-client-react";
import { csvCell, filterModules, groupByCycle, isMissingSynthesis, buildCsv } from "./collab-tracking";

const moduleRow = (patch: Partial<ForumTrackingModule> = {}): ForumTrackingModule => ({
  id: 1, code: "ENSAYO", name: "Módulo de ensayo", cycleName: "Ciclo B",
  enabled: true, verificationCurrent: true, reviewNeeded: false, diagnostics: [],
  outcomes: 2, outcomesWithCriteria: 1, criteria: 3, outcomesWithResources: 1,
  resources: 1, resourcesNeedingReview: 0, plannedThreads: 4, createdThreads: 4,
  participants: 2, centers: 1, eligibleParticipants: 4, eligibleCenters: 2,
  publishedVersions: 0, lastActivityAt: null,
  threads: [{ id: 1, title: "ENSAYO", kind: "material_ra", status: "sin_sintesis", version: null, publishedPageId: null }],
  ...patch,
});
const tracking = (modules: ForumTrackingModule[]): ForumCollaborationTracking => ({
  generatedAt: "2026-10-31T00:00:00.000Z", academicYear: "ENSAYO",
  family: "Administración y Gestión", legend: "Documento intercentros de referencia",
  providerCheck: "not_checked", modules,
  totals: { modules: modules.length, enabled: 1, reviewNeeded: 0, participants: 2,
    centers: 1, resources: 1, publishedVersions: 0, openConsultations: 0 },
});

describe("Seguimiento intercentros", () => {
  it("distinguishes absence of a synthesis from an actual open agreement", () => {
    const [thread] = moduleRow().threads;
    expect(isMissingSynthesis(thread)).toBe(true);
    expect(isMissingSynthesis({ ...thread, status: "abierto" })).toBe(false);
    expect(isMissingSynthesis({ ...thread, status: "consensuado" })).toBe(false);
  });
  it("filters live pilot, review and historical publication states", () => {
    const rows = [moduleRow(), moduleRow({ id: 2, enabled: false, publishedVersions: 2, resourcesNeedingReview: 1 })];
    expect(filterModules(rows, "", "disabled").map(m => m.id)).toEqual([2]);
    expect(filterModules(rows, "", "review").map(m => m.id)).toEqual([2]);
    expect(filterModules(rows, "", "published").map(m => m.id)).toEqual([2]);
    expect(filterModules(rows, "no existe", "all")).toEqual([]);
  });
  it("searches code and cycle without ranking people or centers", () => {
    const rows = [moduleRow({ id: 1, name: "Zeta", participants: 100 }), moduleRow({ id: 2, name: "Alfa", participants: 1 })];
    expect(filterModules(rows, "ensayo", "all").map(m => m.id)).toEqual([2, 1]);
    expect(filterModules(rows, "ciclo b", "all")).toHaveLength(2);
    expect(groupByCycle([moduleRow(), moduleRow({ id: 2, cycleName: "Ciclo A" })]).map(([name]) => name))
      .toEqual(["Ciclo A", "Ciclo B"]);
  });
  it("quotes commas, quotes and line breaks and neutralizes spreadsheet formulas", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    for (const value of ["=1+1", "+cmd", "-1+1", "@SUM(1)", "  =HYPERLINK(1)", "\t=1"]) {
      expect(csvCell(value)).toMatch(/^"'/);
    }
    expect(csvCell("Nombre normal")).toBe('"Nombre normal"');
  });
  it("exports only filtered rows and does not recompute distinct people by summing modules", () => {
    const a = moduleRow({ name: "Solo seleccionado" }), b = moduleRow({ id: 2, name: "Otro oculto por filtro" });
    const data = tracking([a, b]);
    const csv = buildCsv(data, [a], "Solo");
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Solo seleccionado");
    expect(csv).not.toContain("Otro oculto por filtro");
    expect(data.totals.participants).toBe(2);
    expect(csv).toContain("Documento intercentros");
    expect(csv.toLowerCase()).toContain("no comprobado");
  });
});
