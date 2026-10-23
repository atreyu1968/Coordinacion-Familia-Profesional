import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyAttendanceCertificates,
  useSendAttendanceEmailCode,
  useVerifyAttendanceEmail,
  useIssueMyAttendanceCertificate,
  type OwnAttendancePendingEvent,
  downloadMyAttendanceCertificate,
  getListMyAttendanceCertificatesQueryKey,
  type MyAttendanceCertificate,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "@/hooks/use-toast";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import { Award, Download, MailCheck, ShieldCheck, Ban, Clock } from "lucide-react";
import {
  apiErrorMessage,
  downloadBase64File,
  formatLongDate,
} from "@/components/events/certificate-utils";


function EmailVerification({ email }: { email: string }) {
  const qc = useQueryClient();
  const sendMut = useSendAttendanceEmailCode();
  const verifyMut = useVerifyAttendanceEmail();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSend = async () => {
    setError(null);
    try {
      await sendMut.mutateAsync();
      setSent(true);
      toast({ title: "Código enviado", description: `Revisa ${email}.` });
    } catch (err) {
      setError(apiErrorMessage(err, "No se pudo enviar el código. Inténtalo más tarde."));
    }
  };

  const autoSent = useRef(false);
  useEffect(() => {
    if (autoSent.current) return;
    autoSent.current = true;
    void onSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onVerify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setError("Introduce los 6 dígitos.");
      return;
    }
    try {
      await verifyMut.mutateAsync({ data: { code } });
      await qc.invalidateQueries({ queryKey: getListMyAttendanceCertificatesQueryKey() });
      toast({ title: "Email verificado" });
    } catch (err) {
      setError(apiErrorMessage(err, "Código incorrecto o caducado."));
    }
  };

  return (
    <Card className="max-w-xl">
      <CardContent className="p-6 space-y-4">
        <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <MailCheck className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Verifica que este correo es tuyo</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Por privacidad, antes de mostrar tus certificados hemos enviado un código de 6 dígitos a <strong className="text-foreground">{email}</strong>, el correo de tu cuenta.
          </p>
        </div>
        {!sent ? (
          <p className="text-sm text-muted-foreground" role="status">
            {sendMut.isPending ? "Enviando el código a tu correo..." : "No se ha podido enviar el código."}
          </p>
        ) : null}
        {!sent && !sendMut.isPending ? (
          <Button onClick={onSend} data-testid="button-send-code">Volver a enviar el código</Button>
        ) : sent ? (
          <div className="space-y-3">
            <InputOTP maxLength={6} value={code} onChange={setCode} data-testid="input-otp">
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
            <div className="flex flex-wrap gap-2">
              <Button onClick={onVerify} disabled={verifyMut.isPending}>
                {verifyMut.isPending ? "Comprobando..." : "Verificar"}
              </Button>
              <Button variant="ghost" onClick={onSend} disabled={sendMut.isPending}>Reenviar código</Button>
            </div>
          </div>
        ) : null}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

function CertificateRow({ c }: { c: MyAttendanceCertificate }) {
  const [busy, setBusy] = useState(false);
  const revoked = Boolean(c.revokedAt);
  const onDownload = async () => {
    setBusy(true);
    try {
      downloadBase64File(await downloadMyAttendanceCertificate(c.id));
    } catch (err) {
      toast({ title: "No se pudo descargar", description: apiErrorMessage(err, "Inténtalo de nuevo."), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border bg-card p-4 pl-5 overflow-hidden ${revoked ? "opacity-75" : ""}`} data-testid={`card-certificate-${c.id}`}>
      <span className={`absolute left-0 inset-y-0 w-1 ${revoked ? "bg-destructive" : "bg-secondary"}`} />
      <div className="min-w-0">
        <div className="font-semibold truncate">{c.eventName}</div>
        <div className="text-xs text-muted-foreground">
          A nombre de {c.attendeeName} · expedido el {formatLongDate(c.issuedAt)}
        </div>
        <div className="text-[11px] font-mono text-muted-foreground mt-0.5">{c.code}</div>
      </div>
      {revoked ? (
        <Badge variant="destructive" className="gap-1 self-start sm:self-center">
          <Ban className="w-3 h-3" /> Revocado el {formatLongDate(c.revokedAt)}
        </Badge>
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          <PdfPreviewDialog
            title={`Certificado · ${c.eventName}`}
            loadPdf={async () => {
              const pdf = await downloadMyAttendanceCertificate(c.id);
              const binary = atob(pdf.contentBase64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              return new Blob([bytes], { type: "application/pdf" });
            }}
          />
          <Button size="sm" variant="outline" className="gap-2" onClick={onDownload} disabled={busy}>
            <Download className="w-4 h-4" /> {busy ? "Preparando..." : "Descargar PDF"}
          </Button>
        </div>
      )}
    </div>
  );
}

function PendingRow({ p }: { p: OwnAttendancePendingEvent }) {
  const qc = useQueryClient();
  const issueMut = useIssueMyAttendanceCertificate();
  const onIssue = async () => {
    try {
      const pdf = await issueMut.mutateAsync({ data: { eventId: p.eventId } });
      downloadBase64File(pdf);
      await qc.invalidateQueries({ queryKey: getListMyAttendanceCertificatesQueryKey() });
      toast({ title: "Certificado emitido", description: p.eventName });
    } catch (err) {
      toast({
        title: "No se pudo emitir el certificado",
        description: apiErrorMessage(err, "Solo puede emitirse cuando el evento ha terminado y tu asistencia está validada."),
        variant: "destructive",
      });
    }
  };
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4" data-testid={`card-pending-${p.eventId}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Clock className="w-4 h-4 text-primary shrink-0" />
        <div className="min-w-0">
          <div className="font-medium truncate">{p.eventName}</div>
          <div className="text-xs text-muted-foreground">Asistencia validada. Puedes emitir tu certificado.</div>
        </div>
      </div>
      <Button size="sm" className="gap-2 shrink-0" onClick={onIssue} disabled={issueMut.isPending} data-testid={`button-issue-${p.eventId}`}>
        <Award className="w-4 h-4" /> {issueMut.isPending ? "Emitiendo..." : "Emitir y descargar PDF"}
      </Button>
    </div>
  );
}

export default function MisCertificadosPage() {
  const { user } = useAuth();
  const q = useListMyAttendanceCertificates({
    query: { queryKey: getListMyAttendanceCertificatesQueryKey(), retry: false },
  });
  const pending = q.data?.pendingEvents ?? [];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-3">
          <Award className="w-7 h-7 text-primary" /> Mis certificados
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          Certificados de asistencia expedidos a tu nombre. Solo tú puedes descargarlos tras verificar tu correo.
        </p>
      </header>

      {q.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : q.error ? (
        <div className="space-y-2">
          <p className="text-sm text-destructive">{apiErrorMessage(q.error, "No se pudieron cargar tus certificados.")}</p>
          <Button variant="outline" onClick={() => void q.refetch()}>Reintentar</Button>
        </div>
      ) : !q.data?.emailVerified ? (
        <EmailVerification email={user?.email ?? "tu correo"} />
      ) : (
        <div className="space-y-6">
          <p className="text-xs text-emerald-700 flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" /> Correo verificado</p>
          {pending.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Pendientes de emitir</h2>
              {pending.map((p) => <PendingRow key={p.eventId} p={p} />)}
            </section>
          )}
          {q.data.items.length === 0 && pending.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center space-y-2">
                <Award className="w-10 h-10 mx-auto text-muted-foreground/50" />
                <p className="font-medium">Aún no tienes certificados</p>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Regístrate con el QR de asistencia durante un evento. Cuando la organización valide tu asistencia, el certificado aparecerá aquí.
                </p>
              </CardContent>
            </Card>
          ) : (
            <section className="space-y-2">
              {q.data.items.map((c) => <CertificateRow key={c.id} c={c} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
