import { describe, expect, it } from "vitest";
import { curriculumImportReasons } from "@workspace/db";
import { currentCurriculumImportReport } from "../src/lib/curriculumImportReport";
import catalog from "../../../scripts/src/data/learning-outcomes-adg.json";

const expected = { code: "001", outcomes: [{
  code: "RA1", description: "Resultado", order: 1,
  criteria: [{ code: "a", description: "Criterio", order: 1 }],
}] };
const module = { code: "001", centerId: null };
const ra = [{ id: 7, code: "RA1", description: "Resultado", order: 1 }];
const ce = [{ outcomeId: 7, code: "a", description: "Criterio", order: 1 }];
const codes = (reasons: { code: string }[]) => reasons.map(r => r.code);

describe("Read-only curriculum import explanations", () => {
  it("accepts only an exact code, RA and CE match", () => {
    expect(curriculumImportReasons(module, expected, ra, ce, false)).toEqual([]);
    expect(codes(curriculumImportReasons({ ...module, code: null }, expected, ra, ce, false))).toContain("missing_code");
    expect(codes(curriculumImportReasons(module, { ...expected, code: "" }, ra, ce, false))).toContain("missing_code");
    expect(codes(curriculumImportReasons({ ...module, code: "002" }, expected, ra, ce, false))).toContain("different_code");
  });
  it.each([
    [[{ ...ra[0], description: "Edición local" }], ce],
    [[{ ...ra[0], order: 2 }], ce],
    [[...ra, { ...ra[0], id: 8 }], ce],
    [[], []],
    [ra, []],
    [ra, [{ ...ce[0], description: "Edición local" }]],
    [ra, [{ ...ce[0], order: 2 }]],
    [ra, [...ce, ce[0]]],
  ])("explains differences without changing either input", (outcomes, criteria) => {
    const before = JSON.stringify({ expected, outcomes, criteria });
    expect(codes(curriculumImportReasons(module, expected, outcomes, criteria, false))).toContain("local_curriculum");
    expect(JSON.stringify({ expected, outcomes, criteria })).toBe(before);
  });
  it("retains a prior review even when all curricular rows match", () => {
    expect(codes(curriculumImportReasons(module, expected, ra, ce, true))).toEqual(["previous_review"]);
    expect(codes(curriculumImportReasons({ ...module, centerId: 5 }, expected, ra, ce, false))).toEqual(["center_specific"]);
  });
  it("keeps unresolved and empty entries unverified", () => {
    const pending = currentCurriculumImportReport({
      name: "Formación en centros de trabajo", code: null, centerId: null,
    }, "Título Profesional Básico en Servicios Administrativos", [], [], false);
    expect(codes(pending.reasons)).toContain("pending_manual");
    expect(codes(pending.reasons)).not.toContain("eligible");
    const empty = currentCurriculumImportReport({ name: "Tutoría", code: null, centerId: null },
      "Título Profesional Básico en Informática de Oficina", [], [], false);
    expect(codes(empty.reasons)).toContain("no_curriculum");
  });
  it("does not match a module using a similar name or a different cycle", () => {
    expect(codes(currentCurriculumImportReport({ name: "Tutoría", ...module },
      "Ciclo desconocido", [], [], false).reasons)).toContain("unmatched_identity");
  });

  it("predicts filling missing rows before checking whether a source can be inherited", () => {
    const source = catalog.modules.find(s => s.cycle === "Técnico en Gestión Administrativa" && !!s.code)!;
    const result = currentCurriculumImportReport({ ...module, name: source.name, code: source.code },
      source.cycle, [], [], false);
    expect(codes(result.reasons)).toContain("will_complete_curriculum");
    expect(codes(result.reasons)).toContain("eligible");
    expect(codes(result.reasons)).not.toContain("local_curriculum");
  });

  it("predicts legacy code correction only after the local RA/CE preflight succeeds", () => {
    const source = catalog.modules.find(s => s.cycle === "Técnico en Gestión Administrativa" && !!s.code)!;
    const local = { id: 50, ...module, name: source.name, code: "ANTIGUO" };
    const context = { cycleLevel: source.level, cycleAmbiguous: false, siblings: [local] };
    const result = currentCurriculumImportReport(local, "Gestión Administrativa", [], [], false, context);
    expect(codes(result.reasons)).toContain("will_update_code");
    expect(codes(result.reasons)).toContain("eligible");
    expect(codes(result.reasons)).not.toContain("different_code");
    const edited = [{ id: 1, ...source.outcomes[0], description: "Edición humana", deletedAt: null }];
    const conflict = currentCurriculumImportReport(local, "Gestión Administrativa", edited, [], false, context);
    expect(codes(conflict.reasons)).toContain("local_curriculum");
    expect(codes(conflict.reasons)).not.toContain("will_update_code");
    const canonical = currentCurriculumImportReport(local, source.cycle, [], [], false, context);
    expect(codes(canonical.reasons)).toContain("different_code");
  });

  it("does not promise an import for duplicate identities, occupied codes or deleted RA", () => {
    const source = catalog.modules.find(s => s.cycle === "Técnico en Gestión Administrativa" && !!s.code)!;
    const local = { id: 50, ...module, name: source.name, code: "ANTIGUO" };
    const occupied = currentCurriculumImportReport(local, "Gestión Administrativa", [], [], false, {
      cycleLevel: source.level, cycleAmbiguous: false, siblings: [local, { id: 51, name: "Otro", code: source.code }],
    });
    expect(codes(occupied.reasons)).toContain("code_collision");
    const ambiguous = currentCurriculumImportReport(local, "Gestión Administrativa", [], [], false, {
      cycleLevel: source.level, cycleAmbiguous: true, siblings: [local],
    });
    expect(codes(ambiguous.reasons)).toContain("ambiguous_identity");
    const deleted = currentCurriculumImportReport({ ...local, code: source.code }, source.cycle,
      [{ id: 1, ...source.outcomes[0], deletedAt: new Date() }], [], false);
    expect(codes(deleted.reasons)).toContain("local_curriculum");
    expect(codes(deleted.reasons)).not.toContain("eligible");
  });
});
