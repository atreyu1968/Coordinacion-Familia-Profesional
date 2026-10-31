import type {
  TrainingOfferAiAnalysis,
  TrainingOfferAiCandidate,
} from "@workspace/api-client-react";

export type SourceState =
  | { url: string; status: "pending" | "running" }
  | { url: string; status: "ok"; result: TrainingOfferAiAnalysis }
  | { url: string; status: "error"; error: string };

export type OkSource = Extract<SourceState, { status: "ok" }>;

export type Phase = "form" | "discovering" | "analyzing" | "review" | "applying" | "done";

export const MAX_SOURCE_URLS = 10;
const OFFICIAL_HOSTS = ["www.gobiernodecanarias.org", "gobiernodecanarias.org"];
const OFFICIAL_PATHS = ["/educacion/", "/cmsgob1/export/sites/educacion/"];

export function errorText(e: unknown): string {
  const msg = (e as { message?: unknown })?.message;
  return typeof msg === "string" && msg.trim()
    ? msg
    : "Error desconocido al contactar con el servidor.";
}

export function isAbort(e: unknown) {
  return (e as { name?: string })?.name === "AbortError";
}

export function shortUrl(url: string) {
  try {
    const u = new URL(url);
    const tail = u.pathname.split("/").filter(Boolean).slice(-2).join("/");
    return `${u.hostname}/${tail}`;
  } catch {
    return url;
  }
}

export function parseUrls(text: string) {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Mirrors the server allowlist; returns an error message or null. */
export function validateSourceUrls(urls: string[]): string | null {
  if (urls.length > MAX_SOURCE_URLS)
    return `Puedes indicar como máximo ${MAX_SOURCE_URLS} direcciones oficiales.`;
  for (const raw of urls) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return `Dirección no válida: ${raw}`;
    }
    if (
      u.protocol !== "https:" ||
      !OFFICIAL_HOSTS.includes(u.hostname) ||
      u.username || u.password || u.port ||
      !OFFICIAL_PATHS.some((p) => u.pathname.startsWith(p))
    ) {
      return `Usa una dirección HTTPS del portal oficial de Educación del Gobierno de Canarias: ${raw}`;
    }
  }
  return null;
}

/** Deduplicates candidates across sources by center + cycle. */
export function aggregateCandidates(sources: OkSource[]): TrainingOfferAiCandidate[] {
  const seen = new Map<string, TrainingOfferAiCandidate>();
  for (const s of sources) {
    for (const r of s.result.rows) {
      const key = `${r.centerId}:${r.cycleId}`;
      if (!seen.has(key)) seen.set(key, r);
    }
  }
  return [...seen.values()];
}

export function computeCanApply(input: {
  phase: Phase;
  okCount: number;
  candidateCount: number;
  reviewed: boolean;
  partial: boolean;
  partialAck: boolean;
}) {
  return (
    input.phase === "review" &&
    input.okCount > 0 &&
    input.candidateCount > 0 &&
    input.reviewed &&
    (!input.partial || input.partialAck)
  );
}
