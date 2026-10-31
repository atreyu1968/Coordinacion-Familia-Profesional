import type { AgreementPositionInput, AgreementWorkspace, AgreementPosition } from "@workspace/api-client-react";

export type MobilePosition = AgreementPositionInput["position"];

export const MOBILE_STATUS_LABELS: Record<string, string> = {
  abierto: "Abierto a debate",
  sintesis: "En síntesis",
  propuesta: "Propuesta redactada",
  consulta: "En consulta",
  consensuado: "Consensuado",
  sin_consenso: "Sin consenso",
  revision_normativa: "Pendiente de revisión normativa",
  archivado: "Archivado",
};

export const MOBILE_POSITION_LABELS: Record<MobilePosition, string> = {
  a_favor: "A favor",
  con_reservas: "Con reservas",
  en_contra: "En contra",
};

export function mobilePositionsForVersion(ws: AgreementWorkspace): AgreementPosition[] {
  const v = ws.agreement?.version;
  return v == null ? [] : ws.positions.filter((p) => p.version === v);
}

export function mobilePositionPayload(
  ws: AgreementWorkspace,
  userId: number | null | undefined,
  input: { position: MobilePosition | null; reason: string; centerId: number | null },
): { ok: true; payload: AgreementPositionInput } | { ok: false; error: string } {
  const a = ws.agreement;
  if (!a) return { ok: false, error: "Aún no hay propuesta." };
  if (a.status !== "consulta") return { ok: false, error: "Solo se registran posiciones con la consulta abierta." };
  if (!ws.canPosition) return { ok: false, error: "No figuras en el censo fijado al abrir la consulta." };
  if (!input.position) return { ok: false, error: "Elige una posición." };
  const me = userId == null ? undefined : ws.participants.find((p) => p.id === userId);
  if (!me || me.centers.length === 0) return { ok: false, error: "No figuras en el censo con un centro asignado." };
  if (input.centerId == null || !me.centers.some((c) => c.id === input.centerId)) return { ok: false, error: "Elige uno de tus centros." };
  const reason = input.reason.trim();
  if (input.position !== "a_favor" && reason.length < 10) {
    return { ok: false, error: "Las reservas y la oposición necesitan un motivo explicado." };
  }
  if (reason.length > 5000) return { ok: false, error: "El motivo supera 5000 caracteres." };
  return { ok: true, payload: { revision: a.revision, version: a.version, position: input.position, reason, centerId: input.centerId } };
}

export function mobileNotificationWarning(ws: unknown): string | null {
  const w = (ws as { notificationWarning?: unknown } | null)?.notificationWarning;
  return typeof w === "string" && w.trim() ? w : null;
}
