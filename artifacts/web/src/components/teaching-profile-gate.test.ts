import { describe, expect, it } from "vitest";
import type { MyTeachingProfile } from "@workspace/api-client-react";
import { getTeachingProfileGateState } from "./teaching-profile-gate";

const completeProfile: MyTeachingProfile = {
  user: {
    id: 7,
    name: "Docente",
    email: "docente@example.test",
    role: "teacher",
    status: "active",
    provinceId: 3,
    centerId: 12,
    teachingCenterId: null,
  },
  activeYear: "2026/2027",
  targetCenterId: 12,
  targetCenterName: "Centro de prueba",
  targetProvinceId: 3,
  targetProvinceName: "Provincia de prueba",
  moduleIds: [42],
  doesNotTeach: false,
  modules: [],
};

describe("teaching profile gate", () => {
  it("shows a neutral check state, not the profile form, while the first request is pending", () => {
    expect(
      getTeachingProfileGateState({
        isTeacher: true,
        isPending: true,
        isError: false,
      }),
    ).toEqual({
      checking: true,
      failed: false,
      requiresCompletion: false,
    });
  });

  it("does not open the form after a complete profile is loaded", () => {
    expect(
      getTeachingProfileGateState({
        isTeacher: true,
        isPending: false,
        isError: false,
        profile: completeProfile,
      }),
    ).toEqual({
      checking: false,
      failed: false,
      requiresCompletion: false,
    });
  });

  it("requires completion only after the request resolves with missing data", () => {
    expect(
      getTeachingProfileGateState({
        isTeacher: true,
        isPending: false,
        isError: false,
        profile: { ...completeProfile, moduleIds: [] },
      }).requiresCompletion,
    ).toBe(true);
  });

  it("fails closed with an explicit error state rather than opening a broken form", () => {
    expect(
      getTeachingProfileGateState({
        isTeacher: true,
        isPending: false,
        isError: true,
      }),
    ).toEqual({
      checking: false,
      failed: true,
      requiresCompletion: false,
    });
  });

  it("does not gate users who are not teaching-profile roles", () => {
    expect(
      getTeachingProfileGateState({
        isTeacher: false,
        isPending: true,
        isError: false,
      }),
    ).toEqual({
      checking: false,
      failed: false,
      requiresCompletion: false,
    });
  });
});
