import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  useGetAttendanceRegistration,
  useRegisterEventAttendance,
  getGetAttendanceRegistrationQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { AppLayout } from "@/components/layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { CalendarDays, MapPin, CheckCircle2, Clock, XCircle, LogIn } from "lucide-react";
import { apiErrorMessage, apiErrorStatus } from "@/components/events/certificate-utils";
import logo from "@/assets/logo.png";

function fmt(v?: string | null) {
  return v ? new Date(v).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" }) : null;
}

function Content({ token }: { token: string }) {
  const qc = useQueryClient();
  const q = useGetAttendanceRegistration(token, {
    query: { queryKey: getGetAttendanceRegistrationQueryKey(token), retry: false },
  });
  const regMut = useRegisterEventAttendance();
  const { user } = useAuth();

  const onRegister = async () => {
    try {
      await regMut.mutateAsync({ token });
      await qc.invalidateQueries({ queryKey: getGetAttendanceRegistrationQueryKey(token) });
      toast({ title: "Asistencia registrada", description: "Queda pendiente de validación por la organización." });
    } catch (err) {
      toast({ title: "No se pudo registrar", description: apiErrorMessage(err, "Inténtalo de nuevo."), variant: "destructive" });
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 max-w-xl mx-auto" />;
  if (q.error || !q.data)
    return (
      <Card className="max-w-xl mx-auto">
        <CardContent className="p-6 space-y-3">
          <p className="font-semibold">
            {apiErrorStatus(q.error) === 404 ? "Enlace de asistencia no válido" : "No se pudo cargar el evento"}
          </p>
          <p className="text-sm text-muted-foreground">{apiErrorMessage(q.error, "Comprueba el enlace o el QR escaneado.")}</p>
          <Button variant="outline" onClick={() => void q.refetch()}>Reintentar</Button>
        </CardContent>
      </Card>
    );

  const ev = q.data;
  const start = fmt(ev.startAt);
  const st = ev.attendanceStatus;
  return (
    <Card className="max-w-xl mx-auto overflow-hidden">
      <div className="bg-sidebar text-sidebar-foreground px-6 py-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/60">Registro de asistencia</p>
        <h1 className="text-2xl font-bold mt-1">{ev.eventName}</h1>
      </div>
      <CardContent className="p-6 space-y-5">
        <div className="space-y-1.5 text-sm">
          {start && <p className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-primary" /> {start}</p>}
          {ev.location && <p className="flex items-center gap-2"><MapPin className="w-4 h-4 text-primary" /> {ev.location}</p>}
        </div>
        {st === "confirmed" ? (
          <div className="flex gap-3 rounded-lg bg-emerald-50 text-emerald-900 p-4 text-sm">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div>Tu asistencia está validada. <Link href="/mis-certificados" className="font-semibold underline">Ver mis certificados</Link></div>
          </div>
        ) : st === "pending" ? (
          <div className="flex gap-3 rounded-lg bg-secondary/20 p-4 text-sm">
            <Clock className="w-5 h-5 shrink-0" />
            <div>Registro recibido. La organización debe validar tu asistencia antes de expedir el certificado.</div>
          </div>
        ) : st === "rejected" ? (
          <div className="flex gap-3 rounded-lg bg-destructive/10 text-destructive p-4 text-sm">
            <XCircle className="w-5 h-5 shrink-0" />
            <div>La organización no ha validado tu asistencia a este evento.</div>
          </div>
        ) : !ev.open ? (
          <p className="text-sm text-muted-foreground">El registro de asistencia de este evento está cerrado.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Se registrará a nombre de <strong className="text-foreground">{user?.name}</strong> ({user?.email}), los datos de tu cuenta.
            </p>
            <Button size="lg" className="w-full" onClick={onRegister} disabled={regMut.isPending} data-testid="button-register-attendance">
              {regMut.isPending ? "Registrando..." : "Registrar mi asistencia"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AsistenciaRoute() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const { user, isLoading } = useAuth();
  const { customLogoUrl, appName } = useBranding();

  if (isLoading) return <div role="status" className="p-8 text-center text-muted-foreground">Cargando...</div>;

  if (!user) {
    const next = `/asistencia/${encodeURIComponent(token)}`;
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <img src={customLogoUrl ?? logo} alt={appName} className="h-12 w-auto mx-auto" />
          <Card>
            <CardContent className="p-6 space-y-4">
              <h1 className="text-xl font-bold">Registro de asistencia</h1>
              <p className="text-sm text-muted-foreground">
                Inicia sesión con tu cuenta para registrar tu asistencia. Si la organización te inscribió con un email, usa exactamente ese email.
              </p>
              <Button asChild size="lg" className="w-full gap-2">
                <Link href={`/login?next=${encodeURIComponent(next)}`}><LogIn className="w-4 h-4" /> Iniciar sesión</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <Content token={token} />
    </AppLayout>
  );
}
