import type { AiKnowledgeSourceCoverage } from "@workspace/api-zod";

export type KnowledgeSource = AiKnowledgeSourceCoverage["id"];
export type CoverageObservations = Record<KnowledgeSource, {
  status?: AiKnowledgeSourceCoverage["status"];
  notes: string[];
  omissions: Array<{ reason: string; count: number }>;
  pending?: number;
  errors?: number;
}>;
export const knowledgeSource = (key: string): KnowledgeSource =>
  key.startsWith("nextcloud:") ? "nextcloud" : /^mail(?:-attachment)?:/.test(key) ? "gmail" : "platform";
export const newCoverageObservations = (): CoverageObservations => ({
  platform: { notes: [], omissions: [] },
  gmail: { notes: [], omissions: [] },
  nextcloud: { notes: [], omissions: [] },
});
export function addCoverageOmission(observations: CoverageObservations, source: KnowledgeSource, reason: string) {
  const existing = observations[source].omissions.find(item => item.reason === reason);
  if (existing) existing.count += 1;
  else observations[source].omissions.push({ reason, count: 1 });
}

// Deliberately accepts no private labels, body text or raw extraction errors.
// Only candidates in the *current* access scan contribute to these counts.
export function summarizeKnowledgeCoverage(
  candidates: Array<{ key: string; version: string; omission?: string }>,
  entries: Array<{ sourceKey: string; version: string; status: string; warning: string | null }>,
  observations: CoverageObservations,
): AiKnowledgeSourceCoverage[] {
  const byKey = new Map(entries.map(entry => [entry.sourceKey, entry]));
  return (["platform", "gmail", "nextcloud"] as const).map(id => {
    const info = observations[id];
    const result: AiKnowledgeSourceCoverage = {
      id, status: "ready", indexed: 0, pending: info.pending ?? 0, omitted: 0, errors: info.errors ?? 0,
      notes: [...info.notes], omissions: info.omissions.map(item => ({ ...item })),
    };
    const omit = (reason: string) => {
      const item = result.omissions.find(item => item.reason === reason);
      if (item) item.count += 1;
      else result.omissions.push({ reason, count: 1 });
    };
    for (const candidate of candidates) {
      if (knowledgeSource(candidate.key) !== id) continue;
      const entry = byKey.get(candidate.key);
      if (candidate.omission) { omit(candidate.omission); continue; }
      if (!entry || entry.version !== candidate.version) { result.pending += 1; continue; }
      if (entry.status === "ready") {
        result.indexed += 1;
        if (entry.warning && !result.notes.includes("Hay textos recortados al límite de seguridad; no se consulta su contenido completo.")) {
          result.notes.push("Hay textos recortados al límite de seguridad; no se consulta su contenido completo.");
        }
      } else if (entry.status === "unsupported") omit("Formato de archivo no compatible. Convierte el original a un formato admitido y vuelve a actualizar.");
      else if (entry.status === "error") result.errors += 1;
      else result.pending += 1;
    }
    result.omitted = result.omissions.reduce((total, item) => total + item.count, 0);
    if (result.errors) result.notes.push("No se pudo leer o extraer texto de algunos materiales. Actualiza el índice para reintentarlo; si persiste, revisa el original.");
    result.status = info.status ?? (result.errors || result.omitted || result.notes.length ? "partial" : result.pending ? "pending" : "ready");
    return result;
  });
}
