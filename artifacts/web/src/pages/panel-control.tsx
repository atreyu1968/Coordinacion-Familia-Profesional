import { useEffect, useState, type FormEvent } from "react";
import {
  useGetIntegrationSettings,
  useUpdateIntegrationSettings,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, KeyRound, Mail, Sparkles } from "lucide-react";

export default function PanelControlPage() {
  const { user } = useAuth();
  const { data: settings, isLoading, refetch } = useGetIntegrationSettings();
  const updateMutation = useUpdateIntegrationSettings();

  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFromEmail, setResendFromEmail] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.resendFromEmail) {
      setResendFromEmail(settings.resendFromEmail);
    }
  }, [settings?.resendFromEmail]);

  if (user && user.role !== "superadmin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Panel de Control</h1>
        <p className="text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </div>
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavedMessage(null);
    setErrorMessage(null);

    const payload: {
      deepseekApiKey?: string;
      resendApiKey?: string;
      resendFromEmail?: string;
    } = {};
    if (deepseekApiKey.trim()) payload.deepseekApiKey = deepseekApiKey.trim();
    if (resendApiKey.trim()) payload.resendApiKey = resendApiKey.trim();
    if (resendFromEmail.trim()) payload.resendFromEmail = resendFromEmail.trim();

    try {
      await updateMutation.mutateAsync({ data: payload });
      setDeepseekApiKey("");
      setResendApiKey("");
      setSavedMessage("Configuración guardada correctamente.");
      await refetch();
    } catch {
      setErrorMessage("No se pudo guardar la configuración. Inténtalo de nuevo.");
    }
  };

  const StatusBadge = ({ active }: { active: boolean }) =>
    active ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Configurado
      </span>
    ) : (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <XCircle className="h-3.5 w-3.5" />
        Sin configurar
      </span>
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Panel de Control</h1>
        <p className="text-muted-foreground">
          Gestiona las integraciones y la coordinación provincial de la
          plataforma. Solo accesible para la superadministración.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">DeepSeek (IA)</CardTitle>
            </div>
            <StatusBadge active={!!settings?.deepseekConfigured} />
          </CardHeader>
          <CardContent>
            <CardDescription>
              Genera y resume contenido con IA. Sin clave, las funciones de IA se
              desactivan de forma controlada.
            </CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Resend (Email)</CardTitle>
            </div>
            <StatusBadge active={!!settings?.resendConfigured} />
          </CardHeader>
          <CardContent>
            <CardDescription>
              Envía invitaciones y enlaces mágicos por correo. Sin clave, los
              enlaces se muestran en pantalla en su lugar.
            </CardDescription>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Claves de integración</CardTitle>
          </div>
          <CardDescription>
            Introduce una clave nueva para actualizarla. Deja un campo vacío para
            mantener la clave actual sin cambios.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="deepseekApiKey">Clave API de DeepSeek</Label>
              <Input
                id="deepseekApiKey"
                type="password"
                placeholder="sk-..."
                value={deepseekApiKey}
                onChange={(e) => setDeepseekApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resendApiKey">Clave API de Resend</Label>
              <Input
                id="resendApiKey"
                type="password"
                placeholder="re_..."
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="resendFromEmail">
                Correo remitente (Resend)
              </Label>
              <Input
                id="resendFromEmail"
                type="email"
                placeholder="coordinacion@centro.es"
                value={resendFromEmail}
                onChange={(e) => setResendFromEmail(e.target.value)}
              />
            </div>

            {savedMessage && (
              <p className="text-sm font-medium text-green-600">
                {savedMessage}
              </p>
            )}
            {errorMessage && (
              <p className="text-sm font-medium text-destructive">
                {errorMessage}
              </p>
            )}

            <Button
              type="submit"
              disabled={isLoading || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
