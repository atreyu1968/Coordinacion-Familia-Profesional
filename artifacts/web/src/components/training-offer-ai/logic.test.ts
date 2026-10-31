import { describe, expect, it } from "vitest";
import {
  aggregateCandidates,
  computeCanApply,
  validateSourceUrls,
  type OkSource,
} from "./logic";

const row = (centerId: number, cycleId: number, existing = false, sourceUrl = "https://www.gobiernodecanarias.org/educacion/a") => ({
  centerId, centerCode: `C${centerId}`, centerName: `Centro ${centerId}`, cycleId, cycleName: `Ciclo ${cycleId}`,
  level: null, sourceUrl, evidence: "texto", existing,
});
const src = (url: string, rows: ReturnType<typeof row>[]): OkSource => ({
  url, status: "ok", result: { rows, rejected: 0, warnings: [], resultToken: url },
});
const base = { phase: "review" as const, okCount: 1, reviewed: true, partial: false, partialAck: false };

describe("oferta formativa con IA", () => {
  it("desactiva aplicar si no hay propuestas", () => {
    expect(computeCanApply({ ...base, candidateCount: 0 })).toBe(false);
    expect(computeCanApply({ ...base, candidateCount: 2 })).toBe(true);
    expect(computeCanApply({ ...base, candidateCount: 2, partial: true })).toBe(false);
    expect(computeCanApply({ ...base, candidateCount: 2, partial: true, partialAck: true })).toBe(true);
  });

  it("deduplica propuestas solapadas entre fuentes", () => {
    const rows = aggregateCandidates([
      src("a", [row(1, 10), row(1, 11, true)]),
      src("b", [row(1, 10, false, "b"), row(2, 10)]),
    ]);
    expect(rows.map((r) => `${r.centerId}:${r.cycleId}`)).toEqual(["1:10", "1:11", "2:10"]);
    expect(rows.filter((r) => !r.existing)).toHaveLength(2);
  });

  it("valida direcciones oficiales", () => {
    expect(validateSourceUrls(["https://www.gobiernodecanarias.org/educacion/x.pdf"])).toBeNull();
    expect(validateSourceUrls(["http://www.gobiernodecanarias.org/educacion/x"])).not.toBeNull();
    expect(validateSourceUrls(["https://example.org/educacion/x"])).not.toBeNull();
  });
});
