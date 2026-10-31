import { useQueryClient } from "@tanstack/react-query";
import {
  getGetForumAgreementQueryKey,
  useGetForumAgreement,
  type AgreementParticipation,
} from "@workspace/api-client-react";
import { errorMessage } from "@/components/forum-collaboration";
import { agreementErrorKind, STATUS_ORDER, STATUS_LABELS, type AgreementStatus } from "@/lib/forum-agreement";
import { AlertTriangle, Users } from "lucide-react";

export function useAgreementWorkspace(threadId: number) {
  return useGetForumAgreement(threadId, {
    query: {
      queryKey: getGetForumAgreementQueryKey(threadId),
      enabled: threadId > 0,
      retry: false,
      staleTime: 15_000,
      refetchInterval: 45_000,
      refetchOnWindowFocus: true,
    },
  });
}

export function useInvalidateAgreement(threadId: number) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: getGetForumAgreementQueryKey(threadId) });
}

export function describeAgreementError(err: unknown, fallback: string): string {
  switch (agreementErrorKind(err)) {
    case "stale":
      return "Otra persona ha cambiado el acuerdo mientras escribías. Hemos recargado los datos; tu borrador sigue aquí para que lo revises antes de reenviarlo.";
    case "forbidden":
      return "No tienes permiso para esta acción. Puede que tu rol o la delegación hayan cambiado.";
    case "unavailable":
      return errorMessage(err, "El servicio externo no está disponible ahora mismo. No se ha creado nada; inténtalo más tarde.");
    case "invalid":
      return errorMessage(err, "Los datos no son válidos. Revisa los campos marcados.");
    default:
      return errorMessage(err, fallback);
  }
}

const TONE: Record<AgreementStatus, string> = {
  abierto: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-200",
  sintesis: "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200",
  propuesta: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/40 dark:text-violet-200",
  consulta: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200",
  consensuado: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200",
  sin_consenso: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200",
  revision_normativa: "bg-orange-100 text-orange-900 border-orange-200 dark:bg-orange-950/40 dark:text-orange-200",
  archivado: "bg-muted text-muted-foreground border-border",
};

export function StatusPill({ status }: { status: AgreementStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE[status]}`}
      data-testid="status-agreement"
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Horizontal track of the deliberation path; closed branches are shown as alternatives. */
export function StatusTrack({ status }: { status: AgreementStatus }) {
  const main: AgreementStatus[] = ["abierto", "sintesis", "propuesta", "consulta"];
  const idx = STATUS_ORDER.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[10px] font-medium uppercase tracking-wide" aria-label="Fase del acuerdo">
      {main.map((s, i) => {
        const reached = idx >= STATUS_ORDER.indexOf(s) && status !== "archivado";
        const current = s === status;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={`rounded px-1.5 py-0.5 ${current ? "bg-primary text-primary-foreground" : reached ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
            >
              {STATUS_LABELS[s].replace("Propuesta redactada", "Propuesta").replace("Abierto a debate", "Debate")}
            </span>
            {i < main.length - 1 && <span className="h-px w-2 bg-border" aria-hidden />}
          </li>
        );
      })}
      {idx > 3 && (
        <li className="flex items-center gap-1">
          <span className="h-px w-2 bg-border" aria-hidden />
          <StatusPill status={status} />
        </li>
      )}
    </ol>
  );
}

export function ParticipationLine({ p }: { p: AgreementParticipation }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-agreement-participation">
        <Users className="h-3.5 w-3.5" />
        <span>
          <strong className="text-foreground">{p.teachers}</strong> docentes ·{" "}
          <strong className="text-foreground">{p.centers}</strong> centros · censo al abrir la consulta{" "}
          <strong className="text-foreground">{p.eligible}</strong>
        </span>
      </p>
      {p.limited && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300" data-testid="text-agreement-limited">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {p.warning || "Participación limitada: el resultado no representa al conjunto del profesorado."}
        </p>
      )}
    </div>
  );
}

/** User text shown verbatim (no markdown interpretation, no stripping). */
export function PlainTextPreview({ text, compact }: { text: string; compact?: boolean }) {
  if (!text.trim()) return <p className="text-sm italic text-muted-foreground">Sin texto propuesto todavía.</p>;
  return (
    <p
      className={`whitespace-pre-wrap break-words font-serif text-[15px] leading-relaxed text-foreground/90 ${compact ? "line-clamp-6" : ""}`}
      data-testid="text-agreement-preview"
    >
      {text}
    </p>
  );
}

export function formatAgreementDate(value: string): string {
  return new Date(value).toLocaleString("es-ES", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
