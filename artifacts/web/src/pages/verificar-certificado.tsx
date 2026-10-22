import { useParams } from "wouter";
import {
  useVerifyAttendanceCertificate,
  getVerifyAttendanceCertificateQueryKey,
} from "@workspace/api-client-react";
import { useBranding } from "@/lib/branding";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldX, ShieldQuestion } from "lucide-react";
import { apiErrorStatus, formatLongDate, MODALITY_LABELS } from "@/components/events/certificate-utils";
import logo from "@/assets/logo.png";

export default function VerificarCertificadoPage() {
  const { token = "" } = useParams<{ token: string }>();
  const { customLogoUrl, appName } = useBranding();
  const q = useVerifyAttendanceCertificate(token, {
    query: { queryKey: getVerifyAttendanceCertificateQueryKey(token), retry: false },
  });
  const unknown = apiErrorStatus(q.error) === 404;
  const d = q.data;
  const revoked = Boolean(d?.revokedAt) || (d ? !d.valid : false);

  const rows: [string, string][] = d
    ? [
        ["Persona", d.attendeeName],
        ["Evento", d.eventName],
        ["Fechas", d.startAt === d.endAt || !d.endAt ? formatLongDate(d.startAt) : `${formatLongDate(d.startAt)} – ${formatLongDate(d.endAt)}`],
        ["Modalidad", MODALITY_LABELS[d.modality] ?? d.modality],
        ...(d.location ? [["Lugar", d.location] as [string, string]] : []),
        ["Duración", `${Math.floor(d.durationMinutes / 60)} h${d.durationMinutes % 60 ? ` ${d.durationMinutes % 60} min` : ""}`],
        ["Firma", `${d.signerName}, ${d.signerRole}`],
        ["Fecha de expedición", formatLongDate(d.issueDate)],
        ["Código", d.code],
      ]
    : [];

  return (
    <div className="min-h-[100dvh] bg-background px-4 py-10">
      <div className="max-w-xl mx-auto space-y-6">
        <img src={customLogoUrl ?? logo} alt={appName} className="h-11 w-auto" />
        <h1 className="text-2xl font-bold tracking-tight">Verificación de certificado de asistencia</h1>

        {q.isLoading ? (
          <Skeleton className="h-80 w-full" />
        ) : q.error ? (
          <div className="rounded-xl border p-6 space-y-3">
            <div className="flex items-center gap-3">
              <ShieldQuestion className="w-8 h-8 text-muted-foreground" />
              <p className="font-semibold">{unknown ? "Certificado no encontrado" : "No se pudo comprobar"}</p>
            </div>
            <p className="text-sm text-muted-foreground">
              {unknown
                ? "No existe ningún certificado con este código. El documento no puede considerarse emitido por esta plataforma."
                : "Inténtalo de nuevo en unos minutos."}
            </p>
            {!unknown && <Button variant="outline" onClick={() => void q.refetch()}>Reintentar</Button>}
          </div>
        ) : d ? (
          <div className="rounded-xl border bg-card overflow-hidden">
            <div className={`p-5 flex items-center gap-3 ${revoked ? "bg-destructive/10 text-destructive" : "bg-emerald-50 text-emerald-900"}`}>
              {revoked ? <ShieldX className="w-9 h-9" /> : <ShieldCheck className="w-9 h-9" />}
              <div>
                <p className="font-bold text-lg" data-testid="status-certificate">{revoked ? "Certificado revocado" : "Certificado válido"}</p>
                <p className="text-xs">
                  {revoked && d.revokedAt ? `Revocado el ${formatLongDate(d.revokedAt)}. Ya no acredita la asistencia.` : `Expedido el ${formatLongDate(d.issuedAt)}.`}
                </p>
              </div>
            </div>
            <dl className="divide-y">
              {rows.map(([k, v]) => (
                <div key={k} className="grid grid-cols-[130px_1fr] gap-3 px-5 py-2.5 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className={`font-medium break-words ${k === "Código" ? "font-mono text-xs" : ""}`}>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <div className="text-xs text-muted-foreground space-y-2 leading-relaxed">
          <p>Compara el nombre, el evento y las fechas mostrados aquí con los del documento que tienes delante. Si no coinciden, el documento no es auténtico.</p>
          <p>Este código QR es un mecanismo de comprobación de la plataforma y <strong>no constituye una firma electrónica cualificada</strong>.</p>
        </div>
      </div>
    </div>
  );
}
