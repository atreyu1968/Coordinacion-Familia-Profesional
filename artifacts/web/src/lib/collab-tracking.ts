import type { ForumCollaborationTracking, ForumTrackingModule, ForumTrackingThread } from "@workspace/api-client-react";

export const SIN_CICLO = "Sin ciclo";

export const THREAD_STATUS_LABELS: Record<string, string> = {
  abierto: "Abierto",
  sintesis: "En síntesis",
  propuesta: "Propuesta",
  consulta: "En consulta",
  consensuado: "Consensuado",
  sin_consenso: "Sin consenso",
  revision_normativa: "Revisión normativa",
  archivado: "Archivado",
};


export function isMissingSynthesis(t: ForumTrackingThread): boolean {
  return t.status === "sin_sintesis";
}

export function threadStatusLabel(t: ForumTrackingThread): string {
  if (isMissingSynthesis(t)) return "Sin síntesis";
  return THREAD_STATUS_LABELS[t.status] ?? t.status.replace(/_/g, " ");
}

export const THREAD_KIND_LABELS: Record<string, string> = {
  programming_section: "Programación",
  material_ra: "Material RA",
  material_ce: "Material CE",
};

export type StateFilter = "all" | "enabled" | "disabled" | "review" | "missing" | "published";

export const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "enabled", label: "Piloto activo" },
  { value: "disabled", label: "Piloto desactivado" },
  { value: "review", label: "Revisión curricular" },
  { value: "missing", label: "Temas sin síntesis" },
  { value: "published", label: "Con versiones publicadas" },
];

export function missingCount(m: ForumTrackingModule): number {
  return m.threads.filter(isMissingSynthesis).length;
}

export function filterModules(mods: ForumTrackingModule[], q: string, state: StateFilter): ForumTrackingModule[] {
  const s = q.trim().toLowerCase();
  return mods
    .filter((m) =>
      !s || m.name.toLowerCase().includes(s) || (m.code ?? "").toLowerCase().includes(s) || (m.cycleName ?? "").toLowerCase().includes(s),
    )
    .filter((m) => {
      switch (state) {
        case "enabled": return m.enabled;
        case "disabled": return !m.enabled;
        case "review": return m.reviewNeeded || m.resourcesNeedingReview > 0;
        case "missing": return missingCount(m) > 0 || m.createdThreads < m.plannedThreads;
        case "published": return m.publishedVersions > 0;
        default: return true;
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function groupByCycle(mods: ForumTrackingModule[]): [string, ForumTrackingModule[]][] {
  const map = new Map<string, ForumTrackingModule[]>();
  for (const m of mods) {
    const k = m.cycleName ?? SIN_CICLO;
    map.set(k, [...(map.get(k) ?? []), m]);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0], "es"));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Sin actividad";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" });
}

/** Neutralises spreadsheet formula injection and quotes per RFC 4180. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export const METRIC_DEFINITIONS: [string, string][] = [
  ["Módulos con piloto", "Solo módulos con piloto configurado (activos o desactivados), no el catálogo completo."],
  ["Participantes", "Personas elegibles actualmente con una respuesta real (sin mensajes automáticos) o una acción de síntesis registrada en temas vivos previstos, o con una postura en la versión vigente del acuerdo."],
  ["Centros con postura", "Solo centros seleccionados explícitamente y aún autorizados en posturas de la versión vigente; no se infieren por autoría ni por voto colectivo."],
  ["Elegibles", "Censo vivo actual de personas y centros, distinto del censo congelado de cualquier acuerdo concreto."],
  ["Recursos", "Material vigente; excluye archivados o de centros de origen no autorizados."],
  ["Recursos pendientes de revisión", "Recursos cuya huella curricular o versión del currículo no coincide con la vigente; se cuentan aparte."],
  ["Versiones publicadas", "Todas las páginas publicadas conservadas del módulo, incluidas versiones anteriores, aunque la versión actual no esté publicada."],
  ["Sin síntesis", "Tema creado que aún no tiene síntesis; es distinto de cualquier estado real del acuerdo."],
  ["Alcance temporal", "Las cifras abarcan el historial visible de los temas; el curso académico determina el acceso actual, no filtra la actividad por fechas."],
  ["Última actividad", "Excluye mensajes generados automáticamente; puede estar vacía."],
  ["Acuerdos", "Nada se aprueba automáticamente ni se presume unanimidad."],
];

export function buildCsv(data: ForumCollaborationTracking, mods: ForumTrackingModule[], filterDesc: string): string {
  const head = [
    "Ciclo", "Código", "Módulo", "Piloto", "Revisión curricular vigente", "Requiere revisión",
    "RA", "RA con criterios", "Criterios", "RA con recursos visibles", "Recursos", "Recursos pendientes de revisión",
    "Temas previstos", "Temas creados", "Temas sin síntesis", "Versiones publicadas (histórico)",
    "Participantes", "Participantes elegibles (censo vivo)", "Centros con postura", "Centros elegibles (censo vivo)", "Última actividad",
  ];
  const rows = mods.map((m) => [
    m.cycleName ?? SIN_CICLO, m.code ?? "", m.name, m.enabled ? "Activo" : "Desactivado",
    m.verificationCurrent ? "Sí" : "No", m.reviewNeeded ? "Sí" : "No",
    m.outcomes, m.outcomesWithCriteria, m.criteria, m.outcomesWithResources, m.resources, m.resourcesNeedingReview,
    m.plannedThreads, m.createdThreads, missingCount(m), m.publishedVersions,
    m.participants, m.eligibleParticipants, m.centers, m.eligibleCenters, m.lastActivityAt ?? "",
  ]);
  const meta = [
    ["Informe", "Seguimiento intercentros por módulo"],
    ["Familia", data.family],
    ["Curso", data.academicYear ?? "No indicado"],
    ["Generado por el servidor", data.generatedAt],
    ["Filtros", filterDesc],
    ["Diagnóstico de sincronización", "No comprobado: no se ha ejecutado diagnóstico; no equivale a cero fallos"],
    ["Leyenda", data.legend],
    ["Nota", "Cifras por módulo. Participantes y centros no se suman entre filas: una misma persona o centro puede figurar en varios módulos."],
    ...METRIC_DEFINITIONS.map(([k, v]) => ["Definición: " + k, v]),
    [],
  ];
  return "\uFEFF" + [...meta, head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

export function downloadCsv(name: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
