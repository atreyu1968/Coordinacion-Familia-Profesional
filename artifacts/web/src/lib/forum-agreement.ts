import type {
  AgreementInput,
  AgreementInputStatus,
  AgreementParticipant,
  AgreementPosition,
  AgreementPositionInput,
  AgreementRecord,
  AgreementSource,
  AgreementWorkspace,
} from "@workspace/api-client-react";

export type AgreementStatus = AgreementInputStatus;
export type PositionValue = AgreementPositionInput["position"];

export const STATUS_ORDER: AgreementStatus[] = [
  "abierto",
  "sintesis",
  "propuesta",
  "consulta",
  "consensuado",
  "sin_consenso",
  "revision_normativa",
  "archivado",
];

export const STATUS_LABELS: Record<AgreementStatus, string> = {
  abierto: "Abierto a debate",
  sintesis: "En síntesis",
  propuesta: "Propuesta redactada",
  consulta: "En consulta",
  consensuado: "Consensuado",
  sin_consenso: "Sin consenso",
  revision_normativa: "Pendiente de revisión normativa",
  archivado: "Archivado",
};

export const STATUS_HINTS: Record<AgreementStatus, string> = {
  abierto: "El hilo sigue deliberando. Nada está decidido.",
  sintesis: "La moderación está resumiendo las aportaciones del hilo.",
  propuesta: "Hay un texto de propuesta, aún editable antes de consultar.",
  consulta: "Texto congelado y censo fijado al abrir la consulta. Solo quienes figuran en ese censo pueden posicionarse; el resto puede seguir debatiendo.",
  consensuado: "Consulta cerrada con motivo documentado. No es una aprobación oficial.",
  sin_consenso: "Consulta cerrada sin acuerdo. Las posiciones quedan registradas.",
  revision_normativa: "Cerrado a la espera de contrastarlo con la normativa vigente. No se puede publicar en este estado.",
  archivado: "Conservado como histórico. El contenido no se modifica.",
};

export const POSITION_LABELS: Record<PositionValue, string> = {
  a_favor: "A favor",
  con_reservas: "Con reservas",
  en_contra: "En contra",
};

/** Statuses where text editing is forbidden without starting a new version. */
export const LOCKED_STATUSES: AgreementStatus[] = [
  "consulta",
  "consensuado",
  "sin_consenso",
  "revision_normativa",
  "archivado",
];
export const CLOSED_STATUSES: AgreementStatus[] = ["consensuado", "sin_consenso", "revision_normativa"];
/** Normative review can never be published. */
export const PUBLISHABLE_STATUSES: AgreementStatus[] = ["consensuado", "sin_consenso"];
const OPEN_STATUSES: AgreementStatus[] = ["abierto", "sintesis", "propuesta"];

export function isTextLocked(a: AgreementRecord | null | undefined): boolean {
  if (!a) return false;
  return LOCKED_STATUSES.includes(a.status) || a.publishedPageId != null;
}

/** Status options the editor may offer for a record (current status always included). */
export function allowedStatuses(a: AgreementRecord | null | undefined, newVersion: boolean): AgreementStatus[] {
  if (!a || newVersion) return ["abierto"];
  switch (a.status) {
    case "abierto":
    case "sintesis":
    case "propuesta":
      return [...OPEN_STATUSES, "consulta", "archivado"];
    case "consulta":
      return ["consulta", ...CLOSED_STATUSES, "archivado"];
    case "consensuado":
    case "sin_consenso":
    case "revision_normativa":
      return [a.status, "archivado"];
    case "archivado":
      return ["archivado"];
  }
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------
const SECRET_PARAM = /(token|secret|password|passwd|pwd|key|sig|signature|auth|session|sid|access)/i;

export function validateSourceUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return "Cada fuente necesita un enlace.";
  if (url.startsWith("/")) {
    if (url.startsWith("//")) return "Enlace interno no válido.";
    if (!/^\/(foros|documentacion)(\/|\?|#|$)/.test(url)) {
      return "Los enlaces internos solo pueden apuntar a /foros o /documentacion.";
    }
    return null;
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `«${url.slice(0, 60)}» no es un enlace válido.`;
  }
  if (u.protocol !== "https:") return "Solo se admiten enlaces https.";
  if (u.username || u.password) return "El enlace no puede incluir credenciales.";
  if (/\/(index\.php\/)?s\/[^/]+/.test(u.pathname)) {
    return "No se admiten enlaces compartidos públicos (/s/...). Usa un enlace que exija iniciar sesión.";
  }
  for (const k of u.searchParams.keys()) {
    if (SECRET_PARAM.test(k)) return "El enlace parece contener un token o secreto. Quítalo antes de guardar.";
  }
  return null;
}

/** Stable Nextcloud file link: https://host/f/123 or https://host/index.php/f/123, nothing else. */
export function validateDocumentUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "El enlace del documento no es válido.";
  }
  if (u.protocol !== "https:") return "El documento debe enlazarse por https.";
  if (u.username || u.password) return "El enlace no puede incluir credenciales.";
  if (u.search || u.hash) return "Usa el enlace estable sin parámetros (/f/<número>).";
  if (!/^(\/[^/]+)*?\/(index\.php\/)?f\/\d+\/?$/.test(u.pathname)) {
    return "Usa el enlace interno estable de Nextcloud (/f/<número> o /index.php/f/<número>). No se aceptan enlaces públicos ni copias.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Draft + payload
// ---------------------------------------------------------------------------
export type AgreementDraft = {
  status: AgreementStatus;
  summary: string;
  proposedText: string;
  observations: string;
  closureReason: string;
  sources: AgreementSource[];
  sourcePostIds: number[];
  editorIds: number[];
  documentUrl: string;
  newVersion: boolean;
  reviewCurrent: boolean;
};

export function draftFrom(a: AgreementRecord | null | undefined): AgreementDraft {
  return {
    status: a?.status ?? "abierto",
    summary: a?.summary ?? "",
    proposedText: a?.proposedText ?? "",
    observations: a?.observations ?? "",
    closureReason: a?.closureReason ?? "",
    sources: a?.sources.map((s) => ({ ...s })) ?? [],
    sourcePostIds: [...(a?.sourcePostIds ?? [])],
    editorIds: [...(a?.editorIds ?? [])],
    documentUrl: a?.documentUrl ?? "",
    newVersion: false,
    reviewCurrent: false,
  };
}

/** Starting a new version resets to abierto but keeps the text as base. */
export function startNewVersion(d: AgreementDraft): AgreementDraft {
  return { ...d, newVersion: true, status: "abierto", closureReason: "", reviewCurrent: false };
}

export function currentVersionPositions(ws: AgreementWorkspace): AgreementPosition[] {
  const v = ws.agreement?.version;
  return v == null ? [] : ws.positions.filter((p) => p.version === v);
}

export type DraftCheck = { ok: true; payload: AgreementInput } | { ok: false; error: string };

export function buildAgreementPayload(ws: AgreementWorkspace, d: AgreementDraft): DraftCheck {
  const a = ws.agreement;
  const fail = (error: string): DraftCheck => ({ ok: false, error });
  if (!ws.canEdit) return fail("No tienes permiso para editar la síntesis de este hilo.");
  const allowed = allowedStatuses(a, d.newVersion);
  if (!allowed.includes(d.status)) {
    return fail(`No se puede pasar de «${STATUS_LABELS[a?.status ?? "abierto"]}» a «${STATUS_LABELS[d.status]}».`);
  }
  if (d.newVersion && !d.reviewCurrent) {
    return fail("Para abrir una nueva versión confirma que has revisado el currículo vigente.");
  }
  if (!a && !ws.curriculumCurrent && !d.reviewCurrent) {
    return fail("El currículo del piloto ha cambiado. Confirma la revisión antes de crear la síntesis.");
  }
  const locked = isTextLocked(a) && !d.newVersion;
  if (locked && a) {
    const changed =
      d.summary !== a.summary ||
      d.proposedText !== a.proposedText ||
      JSON.stringify(d.sources) !== JSON.stringify(a.sources) ||
      JSON.stringify(d.sourcePostIds) !== JSON.stringify(a.sourcePostIds) ||
      (d.documentUrl.trim() || null) !== a.documentUrl;
    if (changed) return fail("El texto, las fuentes y el documento están congelados en esta versión. Abre una nueva versión para modificarlos.");
  }
  const immutable = !!a && !d.newVersion && (CLOSED_STATUSES.includes(a.status) || a.publishedPageId != null || a.status === "archivado");
  if (immutable && a) {
    if (d.status !== "archivado" || a.status === "archivado") {
      return fail("Esta versión está cerrada y no admite cambios. Solo puedes archivarla o abrir una nueva versión.");
    }
  }
  if (d.summary.length > 3000) return fail("El resumen supera 3000 caracteres.");
  if (d.proposedText.length > 60000) return fail("El texto propuesto supera 60000 caracteres.");
  if (d.observations.length > 10000) return fail("Las observaciones superan 10000 caracteres.");
  if (d.closureReason.length > 5000) return fail("El motivo de cierre supera 5000 caracteres.");
  if (["consulta", ...CLOSED_STATUSES].includes(d.status) && !d.proposedText.trim() && !locked) {
    return fail("Necesitas un texto propuesto antes de abrir la consulta o cerrarla.");
  }
  const closing = a?.status === "consulta" && CLOSED_STATUSES.includes(d.status);
  if (closing) {
    if (d.closureReason.trim().length < 10) {
      return fail("Documenta el motivo de cierre (al menos una frase) antes de cerrar la consulta.");
    }
    if (d.status === "consensuado" && currentVersionPositions(ws).length < 1) {
      return fail("Para marcar «Consensuado» debe constar al menos una posición en esta versión.");
    }
  }
  if (d.sources.length > 50) return fail("Máximo 50 fuentes.");
  for (const s of d.sources) {
    if (!s.title.trim()) return fail("Cada fuente necesita un título.");
    const e = validateSourceUrl(s.url);
    if (e) return fail(e);
  }
  const docErr = validateDocumentUrl(d.documentUrl);
  if (docErr) return fail(docErr);
  if (d.documentUrl.trim() && !ws.nextcloudConfigured) {
    return fail("Nextcloud no está configurado; no se puede vincular un documento colaborativo.");
  }
  const moderatorIds = new Set(ws.participants.filter((p) => p.isModerator).map((p) => p.id));
  let editorIds = a?.editorIds ?? [];
  if (ws.canDelegate) {
    const bad = d.editorIds.find((id) => !moderatorIds.has(id));
    if (bad != null) return fail("Solo se puede delegar la síntesis en moderadores del foro.");
    editorIds = [...new Set(d.editorIds)];
  }
  const archivingOnly = d.status === "archivado" && a && a.status !== "archivado";
  const base = archivingOnly && a ? draftFrom(a) : d;
  return {
    ok: true,
    payload: {
      revision: a?.revision ?? 0,
      fingerprint: d.newVersion || !a || d.reviewCurrent ? ws.fingerprint : a.fingerprint,
      status: d.status,
      summary: base.summary.trim(),
      proposedText: base.proposedText,
      observations: (archivingOnly ? base.observations : d.observations).trim(),
      closureReason: archivingOnly && a ? a.closureReason : d.closureReason.trim(),
      sources: base.sources.map((s) => ({ title: s.title.trim(), url: s.url.trim() })),
      sourcePostIds: [...new Set(base.sourcePostIds)],
      editorIds,
      documentUrl: base.documentUrl.trim() || null,
      ...(d.newVersion ? { newVersion: true } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------
export function ownParticipant(ws: AgreementWorkspace, userId: number | null | undefined): AgreementParticipant | null {
  if (userId == null) return null;
  return ws.participants.find((p) => p.id === userId) ?? null;
}

export function positionNeedsReason(p: PositionValue): boolean {
  return p === "con_reservas" || p === "en_contra";
}

export type PositionCheck = { ok: true; payload: AgreementPositionInput } | { ok: false; error: string };

export function buildPositionPayload(
  ws: AgreementWorkspace,
  userId: number | null | undefined,
  input: { position: PositionValue | null; reason: string; centerId: number | null },
): PositionCheck {
  const a = ws.agreement;
  if (!a) return { ok: false, error: "Aún no hay propuesta sobre la que posicionarse." };
  if (a.status !== "consulta") return { ok: false, error: "Solo se registran posiciones mientras la consulta está abierta." };
  if (!ws.canPosition) return { ok: false, error: "No figuras en el censo fijado al abrir la consulta. Puedes seguir debatiendo en el hilo." };
  if (!input.position) return { ok: false, error: "Elige una posición." };
  const me = ownParticipant(ws, userId);
  if (!me || me.centers.length === 0) return { ok: false, error: "No figuras en el censo con un centro asignado." };
  if (input.centerId == null || !me.centers.some((c) => c.id === input.centerId)) {
    return { ok: false, error: "Elige uno de tus centros." };
  }
  const reason = input.reason.trim();
  if (positionNeedsReason(input.position) && reason.length < 10) {
    return { ok: false, error: "Las reservas y la oposición necesitan un motivo explicado (al menos una frase)." };
  }
  if (reason.length > 5000) return { ok: false, error: "El motivo supera 5000 caracteres." };
  return {
    ok: true,
    payload: { revision: a.revision, version: a.version, position: input.position, reason, centerId: input.centerId },
  };
}

// ---------------------------------------------------------------------------
// Aggregation for presentation
// ---------------------------------------------------------------------------
export type PositionSummary = {
  total: number;
  counts: Record<PositionValue, number>;
  centers: number;
  objections: AgreementPosition[];
};

export function summarizePositions(positions: AgreementPosition[]): PositionSummary {
  const counts: Record<PositionValue, number> = { a_favor: 0, con_reservas: 0, en_contra: 0 };
  const centers = new Set<string>();
  for (const p of positions) {
    counts[p.position] += 1;
    centers.add(p.centerId != null ? `id:${p.centerId}` : `n:${p.centerName}`);
  }
  const rank = { en_contra: 0, con_reservas: 1, a_favor: 2 } as const;
  return {
    total: positions.length,
    counts,
    centers: centers.size,
    objections: positions
      .filter((p) => p.position !== "a_favor")
      .sort((x, y) => rank[x.position] - rank[y.position] || x.updatedAt.localeCompare(y.updatedAt)),
  };
}

/** History grouped by version, newest version first, newest entry first. */
export function historyByVersion(history: AgreementPosition[]): Array<{ version: number; items: AgreementPosition[] }> {
  const map = new Map<number, AgreementPosition[]>();
  for (const p of history) map.set(p.version, [...(map.get(p.version) ?? []), p]);
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([version, items]) => ({ version, items: [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }));
}

export function agreementErrorKind(err: unknown): "stale" | "forbidden" | "unavailable" | "invalid" | "other" {
  const s = (err as { status?: number })?.status;
  if (s === 409 || s === 412) return "stale";
  if (s === 403 || s === 401) return "forbidden";
  if (s === 503 || s === 502 || s === 504) return "unavailable";
  if (s === 400 || s === 422) return "invalid";
  return "other";
}

export const publishedPageHref = (pageId: number) => `/documentacion?page=${pageId}`;
export const collaborationHref = (moduleId: number) => `/espacio?module=${moduleId}`;

/** Name of a participant by id, or null; never guessed. */
export function participantName(ws: AgreementWorkspace, id: number | null | undefined): string | null {
  if (id == null) return null;
  return ws.participants.find((p) => p.id === id)?.name ?? null;
}

export function notificationWarningOf(ws: unknown): string | null {
  const w = (ws as { notificationWarning?: unknown } | null)?.notificationWarning;
  return typeof w === "string" && w.trim() ? w : null;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LEGEND =
  "Documento de referencia intercentros elaborado en el foro. No constituye aprobación oficial ni norma de obligado cumplimiento. La versión final consolidada se publica en Documentación.";

/** Plain-text initial template; user text is copied verbatim. */
export function agreementTemplateText(ws: AgreementWorkspace, moduleName: string, threadTitle: string): string {
  const a = ws.agreement;
  const pos = currentVersionPositions(ws);
  const s = summarizePositions(pos);
  const lines = [
    `ACUERDO INTERCENTROS (BORRADOR) - ${threadTitle}`,
    `Módulo: ${moduleName}`,
    a ? `Versión ${a.version} · Estado: ${STATUS_LABELS[a.status]} · Currículo ${a.curriculumVersion}` : "Sin síntesis",
    "",
    `AVISO: ${LEGEND}`,
    "",
    `Participación: ${ws.participation.teachers} docentes · ${ws.participation.centers} centros · censo ${ws.participation.eligible}`,
    ...(ws.participation.limited ? [`Participación limitada: ${ws.participation.warning}`] : []),
    "",
    "RESUMEN", a?.summary ?? "", "",
    "TEXTO PROPUESTO", a?.proposedText ?? "", "",
    "OBSERVACIONES", a?.observations ?? "", "",
    "POSICIONES",
    `${POSITION_LABELS.a_favor}: ${s.counts.a_favor} · ${POSITION_LABELS.con_reservas}: ${s.counts.con_reservas} · ${POSITION_LABELS.en_contra}: ${s.counts.en_contra}`,
    ...s.objections.map((p) => `- ${p.userName ?? "Docente"} (${p.centerName}) · ${POSITION_LABELS[p.position]}: ${p.reason}`),
    "",
    "FUENTES",
    ...(a?.sources ?? []).map((x) => `- ${x.title}: ${x.url}`),
  ];
  return lines.join("\n");
}

export function agreementTemplateHtml(ws: AgreementWorkspace, moduleName: string, threadTitle: string): string {
  const a = ws.agreement;
  const s = summarizePositions(currentVersionPositions(ws));
  const pre = (t: string) => `<p style="white-space:pre-wrap">${esc(t)}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(threadTitle)}</title></head><body>
<h1>Acuerdo intercentros (borrador): ${esc(threadTitle)}</h1>
<p>Módulo: ${esc(moduleName)}${a ? ` · Versión ${a.version} · Estado: ${esc(STATUS_LABELS[a.status])} · Currículo ${esc(a.curriculumVersion)}` : ""}</p>
<p><strong>Aviso:</strong> ${esc(LEGEND)}</p>
<p>Participación: ${ws.participation.teachers} docentes · ${ws.participation.centers} centros · censo ${ws.participation.eligible}${ws.participation.limited ? ` — ${esc(ws.participation.warning || "participación limitada")}` : ""}</p>
<h2>Resumen</h2>${pre(a?.summary ?? "")}
<h2>Texto propuesto</h2>${pre(a?.proposedText ?? "")}
<h2>Observaciones</h2>${pre(a?.observations ?? "")}
<h2>Posiciones</h2><p>${POSITION_LABELS.a_favor}: ${s.counts.a_favor} · ${POSITION_LABELS.con_reservas}: ${s.counts.con_reservas} · ${POSITION_LABELS.en_contra}: ${s.counts.en_contra}</p>
<ul>${s.objections.map((p) => `<li>${esc(p.userName ?? "Docente")} (${esc(p.centerName)}) · ${POSITION_LABELS[p.position]}: ${esc(p.reason)}</li>`).join("")}</ul>
<h2>Fuentes</h2><ul>${(a?.sources ?? []).map((x) => `<li>${esc(x.title)}: ${esc(x.url)}</li>`).join("")}</ul>
</body></html>`;
}
