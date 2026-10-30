import { describe, expect, it } from "vitest";
import type { Center, User } from "@workspace/api-client-react";
import { scopedCenters, userDirectoryCenterParams } from "./user-management";

describe("teacher family-wide user directory", () => {
  it("never applies the dashboard's own-center scope to teacher center options", () => {
    expect(userDirectoryCenterParams("teacher", true)).toEqual({});
    expect(userDirectoryCenterParams("teacher", false)).toEqual({});
    expect(userDirectoryCenterParams("coordinator", true)).toEqual({ dashboardOnly: true });
    expect(userDirectoryCenterParams("department_head", true)).toEqual({ dashboardOnly: true });
    expect(userDirectoryCenterParams("superadmin", false)).toEqual({});
  });

  it("keeps other family centers available regardless of the teacher's own center", () => {
    const centers = [
      { id: 1, provinceId: 10, name: "Centro A" },
      { id: 2, provinceId: 20, name: "Centro B" },
      { id: 3, provinceId: 20, name: "Centro sin usuarios" },
    ] as Center[];
    const teacher = { id: 7, role: "teacher", centerId: 1, provinceId: 10 } as User;
    expect(scopedCenters(teacher, centers)).toEqual(centers);
    expect(scopedCenters({ ...teacher, role: "department_head" }, centers)).toEqual([centers[0]]);
    expect(scopedCenters({ ...teacher, role: "coordinator" }, centers)).toEqual([centers[0]]);
  });
});
