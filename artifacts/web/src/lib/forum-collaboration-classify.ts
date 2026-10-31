import type {
  ForumCollaboration,
  ForumCollaborationThread,
} from "@workspace/api-client-react";

export type ForumCategory = "programacion" | "materiales" | "general";

/** Structured sections are visible only for an enabled pilot, or to configurers. */
export function showsStructure(c: ForumCollaboration | null | undefined): boolean {
  return !!c && (c.enabled || c.canConfigure);
}

/** Map existing forum thread IDs to their collaboration entry. Unlinked threads stay general. */
export function classifyThreads(c: ForumCollaboration | null | undefined) {
  const byThreadId = new Map<number, ForumCollaborationThread>();
  if (c && showsStructure(c)) {
    for (const t of c.threads) if (t.threadId != null) byThreadId.set(t.threadId, t);
  }
  return byThreadId;
}

export function categoryOf(t: ForumCollaborationThread | undefined): ForumCategory {
  if (!t) return "general";
  return t.kind === "programming_section" ? "programacion" : "materiales";
}

/** Existing web module detail route with RA/CE anchors rendered by ModuleOutcomes. */
export function collabAnchor(moduleId: number, t: ForumCollaborationThread): string | null {
  if (t.kind === "material_ce" && t.criterionId != null) return `/academica/modulo/${moduleId}#ce-${t.criterionId}`;
  if (t.kind === "material_ra" && t.outcomeId != null) return `/academica/modulo/${moduleId}#ra-${t.outcomeId}`;
  return null;
}

/** Live (non-archived) material threads per RA/CE for reciprocal links. */
export function outcomeThreadLinks(c: ForumCollaboration | null | undefined) {
  const ra = new Map<number, number>();
  const ce = new Map<number, number>();
  if (c && showsStructure(c)) {
    for (const t of c.threads) {
      if (t.threadId == null || t.archived) continue;
      if (t.kind === "material_ra" && t.outcomeId != null) ra.set(t.outcomeId, t.threadId);
      if (t.kind === "material_ce" && t.criterionId != null) ce.set(t.criterionId, t.threadId);
    }
  }
  return { ra, ce };
}
