import type {
  LearningOutcome,
  Resource,
  ResourceLearningTarget,
} from "@workspace/api-client-react";

export type CurriculumFilter =
  | { kind: "outcome"; outcomeId: number }
  | { kind: "criterion"; criterionId: number };

const WIKI_ATTACHMENT = /^\/api\/wiki\/attachments\/\d+\/download$/;
const CREDENTIAL_PARAMS = [
  "token", "access_token", "auth", "authorization", "session", "sessionid", "sid",
  "sig", "signature", "key", "apikey", "api_key", "expires", "x-amz-signature",
  "x-amz-credential", "x-amz-security-token", "x-goog-signature", "se", "sp", "sv",
  "jwt", "password", "pwd", "code",
];

export function isWikiAttachmentUrl(raw: string): boolean {
  return WIKI_ATTACHMENT.test(raw.trim());
}

/** Returns an error message, or null when the canonical URL is acceptable. */
export function validateCanonicalUrl(raw: string, restricted: boolean): string | null {
  const value = raw.trim();
  if (!value) return "Indica la URL canónica del recurso.";
  if (isWikiAttachmentUrl(value)) return null;
  if (restricted) {
    return "Las soluciones restringidas solo admiten un adjunto protegido de la wiki (/api/wiki/attachments/{id}/download).";
  }
  if (value.startsWith("/objects") || value.includes("/objects/")) {
    return "No se admiten rutas de almacenamiento interno (/objects).";
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "La URL no es válida. Usa https:// o un adjunto de la wiki.";
  }
  if (url.protocol !== "https:") return "Solo se admiten enlaces https://.";
  if (url.username || url.password) return "El enlace no puede incluir usuario ni contraseña.";
  for (const k of url.searchParams.keys()) {
    const lk = k.toLowerCase();
    if (CREDENTIAL_PARAMS.includes(lk) || lk.startsWith("x-amz-") || lk.startsWith("x-goog-")) {
      return "El enlace contiene credenciales, tokens o firmas en la consulta. Usa un enlace estable sin credenciales.";
    }
  }
  if (/^\/(?:index\.php\/)?s\/[^/]+/.test(url.pathname)) {
    return "No se aceptan enlaces compartidos públicos ni enlaces con token de acceso (/s/...). Usa la referencia estable del archivo (p. ej. /index.php/f/123), que exige el inicio de sesión habitual en el proveedor.";
  }
  return null;
}

/** Map criterionId -> parent outcomeId from real module curriculum. */
export function criterionParents(outcomes: LearningOutcome[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const o of outcomes) for (const c of o.criteria) m.set(c.id, o.id);
  return m;
}

export function targetOutcomeId(t: ResourceLearningTarget, parents: Map<number, number>): number | null {
  if (t.criterionId != null) return parents.get(t.criterionId) ?? t.outcomeId ?? null;
  return t.outcomeId ?? null;
}

/** RA filter includes RA-only targets and CE children; CE filter is exact. */
export function matchesCurriculumFilter(
  resource: Resource,
  filter: CurriculumFilter,
  parents: Map<number, number>,
): boolean {
  const targets = resource.curriculum?.targets ?? [];
  if (filter.kind === "criterion") return targets.some((t) => t.criterionId === filter.criterionId);
  return targets.some((t) => targetOutcomeId(t, parents) === filter.outcomeId);
}

export function filterCurriculumResources(
  resources: Resource[],
  filter: CurriculumFilter | null,
  parents: Map<number, number>,
  opts: { includeArchived?: boolean } = {},
): Resource[] {
  return resources.filter((r) => {
    if (!r.curriculum) return false;
    if (!opts.includeArchived && r.curriculum.archived) return false;
    return filter == null || matchesCurriculumFilter(r, filter, parents);
  });
}

export type CurriculumStatus = "current" | "stale" | "archived";

/** stale = associated against a different pilot fingerprint than the current one. */
export function classifyCurriculum(resource: Resource, currentFingerprint: string | null | undefined): CurriculumStatus | null {
  const c = resource.curriculum;
  if (!c) return null;
  if (c.archived) return "archived";
  if (currentFingerprint && c.fingerprint !== currentFingerprint) return "stale";
  return "current";
}

export type ConflictKind = "duplicate" | "revision" | "curriculum" | "other";

export function classifyConflict(err: unknown): ConflictKind | null {
  const e = err as { status?: number; data?: { code?: string; message?: string } | null; message?: string };
  if (e?.status !== 409) return null;
  const text = `${e.data?.code ?? ""} ${e.data?.message ?? e.message ?? ""}`.toLowerCase();
  if (/duplic|exist|ya hay|ya existe/.test(text)) return "duplicate";
  if (/revisi|revision|stale/.test(text)) return "revision";
  if (/fingerprint|huella|curr[ií]cul|version|versión/.test(text)) return "curriculum";
  return "other";
}

/** Normalize targets: unique, no cartesian expansion. */
export function normalizeTargets(targets: ResourceLearningTarget[]): ResourceLearningTarget[] {
  const seen = new Set<string>();
  const out: ResourceLearningTarget[] = [];
  for (const t of targets) {
    const k = `${t.outcomeId}:${t.criterionId ?? "ra"}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ outcomeId: t.outcomeId, criterionId: t.criterionId ?? null });
  }
  return out;
}

export function libraryHref(moduleId: number, filter: CurriculumFilter | null): string {
  const p = new URLSearchParams({ module: String(moduleId) });
  if (filter?.kind === "outcome") p.set("outcomeId", String(filter.outcomeId));
  if (filter?.kind === "criterion") p.set("criterionId", String(filter.criterionId));
  return `/recursos?${p.toString()}`;
}

export function targetLabel(t: ResourceLearningTarget, outcomes: LearningOutcome[]): string {
  const o = outcomes.find((x) => x.id === t.outcomeId);
  if (t.criterionId != null) {
    for (const oo of outcomes) {
      const c = oo.criteria.find((x) => x.id === t.criterionId);
      if (c) return `${oo.code} · ${c.code}`;
    }
    return `CE #${t.criterionId}`;
  }
  return o ? o.code : `RA #${t.outcomeId}`;
}
