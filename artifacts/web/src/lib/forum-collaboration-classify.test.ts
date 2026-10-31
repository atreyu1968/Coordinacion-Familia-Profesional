import { describe, expect, it } from "vitest";
import type { ForumCollaboration, ForumCollaborationThread } from "@workspace/api-client-react";
import {
  categoryOf,
  classifyThreads,
  collabAnchor,
  outcomeThreadLinks,
  showsStructure,
} from "./forum-collaboration-classify";

const entry = (p: Partial<ForumCollaborationThread>): ForumCollaborationThread => ({
  key: "PD-01", kind: "programming_section", title: "t", content: "c",
  outcomeId: null, criterionId: null, threadId: null, archived: false, curriculumVersion: "v1", ...p,
});

const collab = (p: Partial<ForumCollaboration> = {}): ForumCollaboration => ({
  moduleId: 7, moduleCode: "0647", moduleName: "Gestión de la documentación jurídica",
  cycleName: "Administración y Finanzas", academicYear: "2025-2026",
  enabled: true, canConfigure: false, verificationCurrent: true, fingerprint: "fp",
  diagnostics: [], sections: [], configuration: null,
  threads: [
    entry({ key: "PD-01", threadId: 11 }),
    entry({ key: "RA1", kind: "material_ra", outcomeId: 3, threadId: 12 }),
    entry({ key: "RA1-CEa", kind: "material_ce", outcomeId: 3, criterionId: 9, threadId: 13 }),
    entry({ key: "RA2", kind: "material_ra", outcomeId: 4, threadId: 14, archived: true }),
    entry({ key: "PD-02", threadId: null }),
  ],
  ...p,
});

describe("forum collaboration classification", () => {
  it("classifies linked threads and keeps legacy threads general", () => {
    const map = classifyThreads(collab());
    expect(categoryOf(map.get(11))).toBe("programacion");
    expect(categoryOf(map.get(12))).toBe("materiales");
    expect(categoryOf(map.get(13))).toBe("materiales");
    expect(categoryOf(map.get(999))).toBe("general"); // legacy, same id
    expect(map.size).toBe(4); // pending (threadId null) never maps
  });

  it("keeps archived metadata in its section but hides it from RA/CE links", () => {
    const map = classifyThreads(collab());
    expect(map.get(14)?.archived).toBe(true);
    expect(categoryOf(map.get(14))).toBe("materiales");
    const links = outcomeThreadLinks(collab());
    expect(links.ra.get(3)).toBe(12);
    expect(links.ra.has(4)).toBe(false);
    expect(links.ce.get(9)).toBe(13);
  });

  it("ignores structure when the pilot is disabled for ordinary users", () => {
    const off = collab({ enabled: false });
    expect(showsStructure(off)).toBe(false);
    expect(classifyThreads(off).size).toBe(0);
    expect(outcomeThreadLinks(off).ra.size).toBe(0);
    expect(showsStructure(collab({ enabled: false, canConfigure: true }))).toBe(true);
  });

  it("treats unavailable data (403, other family) as an ordinary forum", () => {
    expect(showsStructure(undefined)).toBe(false);
    expect(classifyThreads(undefined).size).toBe(0);
    expect(classifyThreads(null).size).toBe(0);
  });

  it("builds anchors on the existing module detail route", () => {
    expect(collabAnchor(7, entry({ kind: "material_ra", outcomeId: 3 }))).toBe("/academica/modulo/7#ra-3");
    expect(collabAnchor(7, entry({ kind: "material_ce", outcomeId: 3, criterionId: 9 }))).toBe("/academica/modulo/7#ce-9");
    expect(collabAnchor(7, entry({}))).toBeNull();
  });
});
