import { describe, expect, it } from "vitest";
import {
  effectiveProvinceId,
  isWithinParticipationWindow,
} from "../src/lib/audience";

describe("audience and participation-window helpers", () => {
  it("uses the explicit user province before the center fallback", () => {
    expect(effectiveProvinceId(4, 9)).toBe(4);
    expect(effectiveProvinceId(null, 9)).toBe(9);
    expect(effectiveProvinceId(undefined, null)).toBeNull();
  });

  it("enforces inclusive opening and exclusive closing instants", () => {
    const opensAt = new Date("2030-05-10T09:00:00.000Z");
    const closesAt = new Date("2030-05-10T17:00:00.000Z");

    expect(
      isWithinParticipationWindow(
        "open",
        opensAt,
        closesAt,
        new Date("2030-05-10T08:59:59.999Z"),
      ),
    ).toBe(false);
    expect(
      isWithinParticipationWindow(
        "open",
        opensAt,
        closesAt,
        opensAt,
      ),
    ).toBe(true);
    expect(
      isWithinParticipationWindow(
        "open",
        opensAt,
        closesAt,
        closesAt,
      ),
    ).toBe(false);
    expect(
      isWithinParticipationWindow(
        "closed",
        null,
        null,
        new Date("2030-05-10T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
});