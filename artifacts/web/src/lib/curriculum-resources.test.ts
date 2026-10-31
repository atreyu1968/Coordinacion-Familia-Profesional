import { describe, expect, it } from "vitest";
import type { LearningOutcome, Resource } from "@workspace/api-client-react";
import { classifyConflict, classifyCurriculum, criterionParents, filterCurriculumResources, normalizeTargets, validateCanonicalUrl } from "./curriculum-resources";

const outcomes = [
  { id: 1, moduleId: 9, code: "RA1", description: "", order: 1, criteria: [{ id: 11, outcomeId: 1, code: "a", description: "", order: 1 }, { id: 12, outcomeId: 1, code: "b", description: "", order: 2 }] },
  { id: 2, moduleId: 9, code: "RA2", description: "", order: 2, criteria: [{ id: 21, outcomeId: 2, code: "a", description: "", order: 1 }] },
] as LearningOutcome[];
const res = (id: number, targets: { outcomeId: number; criterionId: number | null }[], extra = {}): Resource => ({
  id, title: `r${id}`, type: "Documento",
  curriculum: { moduleId: 9, revision: 1, license: "CC", version: "1", audience: "teachers", restricted: false, archived: false, curriculumVersion: "v1", fingerprint: "f1", canEdit: true, targets, ...extra },
});
const parents = criterionParents(outcomes);
const all = [res(1, [{ outcomeId: 1, criterionId: null }]), res(2, [{ outcomeId: 1, criterionId: 12 }]), res(3, [{ outcomeId: 2, criterionId: 21 }]), res(4, [{ outcomeId: 1, criterionId: 11 }], { archived: true })];

describe("curriculum resource filtering", () => {
  it("RA includes RA-only and CE children", () => {
    expect(filterCurriculumResources(all, { kind: "outcome", outcomeId: 1 }, parents).map((r) => r.id)).toEqual([1, 2]);
  });
  it("CE is exact and excludes RA-only", () => {
    expect(filterCurriculumResources(all, { kind: "criterion", criterionId: 12 }, parents).map((r) => r.id)).toEqual([2]);
  });
  it("archived hidden unless requested", () => {
    expect(filterCurriculumResources(all, { kind: "criterion", criterionId: 11 }, parents, { includeArchived: true }).map((r) => r.id)).toEqual([4]);
  });
  it("normalizes without cartesian", () => {
    expect(normalizeTargets([{ outcomeId: 1, criterionId: null }, { outcomeId: 1, criterionId: null }, { outcomeId: 2, criterionId: 21 }])).toHaveLength(2);
  });
});

describe("stale and conflict classification", () => {
  it("classifies fingerprint drift", () => {
    expect(classifyCurriculum(all[0], "f1")).toBe("current");
    expect(classifyCurriculum(all[0], "f2")).toBe("stale");
    expect(classifyCurriculum(all[3], "f2")).toBe("archived");
  });
  it("classifies 409s", () => {
    expect(classifyConflict({ status: 409, data: { message: "Recurso duplicado" } })).toBe("duplicate");
    expect(classifyConflict({ status: 409, data: { message: "Revisión obsoleta" } })).toBe("revision");
    expect(classifyConflict({ status: 400 })).toBeNull();
  });
});

describe("canonical url", () => {
  it("restricted requires wiki attachment", () => {
    expect(validateCanonicalUrl("/api/wiki/attachments/5/download", true)).toBeNull();
    expect(validateCanonicalUrl("https://example.org/a.pdf", true)).not.toBeNull();
  });
  it("rejects credentials and /objects", () => {
    expect(validateCanonicalUrl("https://example.org/a.pdf?token=x", false)).not.toBeNull();
    expect(validateCanonicalUrl("/objects/abc", false)).not.toBeNull();
    expect(validateCanonicalUrl("https://example.org/a.pdf", false)).toBeNull();
  });
  it("rejects bearer share links on any host, allows stable file refs", () => {
    expect(validateCanonicalUrl("https://docs.example.es/s/AbC123", false)).toMatch(/compartidos/);
    expect(validateCanonicalUrl("https://x.org/index.php/s/AbC123/download", false)).not.toBeNull();
    expect(validateCanonicalUrl("https://nube.example.es/index.php/f/123", false)).toBeNull();
    expect(validateCanonicalUrl("https://nube.example.es/f/123", false)).toBeNull();
  });
});
