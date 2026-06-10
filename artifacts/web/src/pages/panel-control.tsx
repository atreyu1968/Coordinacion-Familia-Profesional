import { useEffect, useRef, useState, type FormEvent } from "react";
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
import {
  CheckCircle2,
  XCircle,
  KeyRound,
  Mail,
  Sparkles,
  Video,
  DatabaseBackup,
  Download,
  Upload,
  AlertTriangle,
} from "lucide-react";

const TOKEN_KEY = "coordina_adg_token";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PanelControlPage() {
  const { user } = useAuth();
  const { data: settings, isLoading, refetch } = useGetIntegrationSettings();
  const updateMutation = useUpdateIntegrationSettings();

  const [deepseekApiKey, setDeepseekApiKey] = useState("");
  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFromEmail, setResendFromEmail] = useState("");
  const [jaasAppId, setJaasAppId] = useState("");
  const [jaasKid, setJaasKid] = useState("");
  const [jaasPrivateKey, setJaasPrivateKey] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  useEffect(() => {
    if (settings?.resendFromEmail) {
      setResendFromEmail(settings.resendFromEmail);
    }
  }, [settings?.resendFromEmail]);

  useEffect(() => {
    if (settings?.jaasAppId) {
      setJaasAppId(settings.jaasAppId);
    }
  }, [settings?.jaasAppId]);

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

  const onDownloadBackup = async () => {
    setBackupMessage(null);
    setBackupError(null);
    setIsDownloading(true);
    try {
      const res = await fetch("/api/backup", { headers: authHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename =
        match?.[1] ??
        `coordina-adg-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupMessage("Copia de seguridad descargada correctamente.");
    } catch {
      setBackupError("No se pudo generar la copia de seguridad.");
    } finally {
      setIsDownloading(false);
    }
  };

  const onRestoreFile = async (e: FormEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBackupMessage(null);
    setBackupError(null);

    const confirmed = window.confirm(
      "Vas a RESTAURAR una copia de seguridad. Esto BORRARÁ todos los datos " +
        "actuales y los sustituirá por los del archivo. Esta acción no se " +
        "puede deshacer. ¿Deseas continuar?",
    );
    if (!confirmed) {
      input.value = "";
      return;
    }

    setIsRestoring(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/zip" },
        body: buffer,
      });
      if (!res.ok) {
        let message = "No se pudo restaurar la copia de seguridad.";
        try {
          const data = (await res.json()) as { message?: string };
          if (data?.message) message = data.message;
        } catch {
          /* keep default message */
        }
        throw new Error(message);
      }
      setBackupMessage(
        "Copia de seguridad restaurada correctamente. Recargando la aplicación...",
      );
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setBackupError(
        err instanceof Error
          ? err.message
          : "No se pudo restaurar la copia de seguridad.",
      );
    } finally {
      setIsRestoring(false);
      input.value = "";
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSavedMessage(null);
    setErrorMessage(null);

    const payload: {
      deepseekApiKey?: string;
      resendApiKey?: string;
      resendFromEmail?: string;
      jaasAppId?: string;
      jaasKid?: string;
      jaasPrivateKey?: string;
    } = {};
    if (deepseekApiKey.trim()) payload.deepseekApiKey = deepseekApiKey.trim();
    if (resendApiKey.trim()) payload.resendApiKey = resendApiKey.trim();
    if (resendFromEmail.trim()) payload.resendFromEmail = resendFromEmail.trim();
    if (jaasAppId.trim()) payload.jaasAppId = jaasAppId.trim();
    if (jaasKid.trim()) payload.jaasKid = jaasKid.trim();
    if (jaasPrivateKey.trim()) payload.jaasPrivateKey = jaasPrivateKey.trim();

    try {
      await updateMutation.mutateAsync({ data: payload });
      setDeepseekApiKey("");
      setResendApiKey("");
      setJaasKid("");
      setJaasPrivateKey("");
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <Video className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">JaaS (Videollamadas)</CardTitle>
            </div>
            <StatusBadge active={!!settings?.jaasConfigured} />
          </CardHeader>
          <CardContent>
            <CardDescription>
              Videollamadas sin límite de tiempo con Jitsi as a Service (8x8).
              Sin configurar, las llamadas usan el servidor público meet.jit.si,
              que corta las sesiones a los 5 minutos.
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

            <div className="space-y-2">
              <Label htmlFor="jaasAppId">AppID de JaaS</Label>
              <Input
                id="jaasAppId"
                type="text"
                placeholder="vpaas-magic-cookie-..."
                value={jaasAppId}
                onChange={(e) => setJaasAppId(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jaasKid">API Key ID de JaaS (kid)</Label>
              <Input
                id="jaasKid"
                type="text"
                placeholder="vpaas-magic-cookie-.../abc123"
                value={jaasKid}
                onChange={(e) => setJaasKid(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="jaasPrivateKey">Clave privada de JaaS</Label>
              <textarea
                id="jaasPrivateKey"
                className="flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                value={jaasPrivateKey}
                onChange={(e) => setJaasPrivateKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <p className="text-xs text-muted-foreground">
                Pega la clave completa, con sus saltos de línea. Déjala vacía
                para mantener la actual sin cambios.
              </p>
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

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">
              Copias de seguridad y migración
            </CardTitle>
          </div>
          <CardDescription>
            Descarga una copia completa de todos los datos en un archivo ZIP
            para guardarla o trasladar la plataforma a otro servidor. La
            restauración sustituye todos los datos actuales por los del archivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={onDownloadBackup}
              disabled={isDownloading || isRestoring}
            >
              <Download className="mr-2 h-4 w-4" />
              {isDownloading
                ? "Generando copia..."
                : "Descargar copia de seguridad"}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isDownloading || isRestoring}
            >
              <Upload className="mr-2 h-4 w-4" />
              {isRestoring ? "Restaurando..." : "Restaurar copia de seguridad"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={onRestoreFile}
            />
          </div>

          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Al restaurar, se eliminarán todos los datos actuales (centros,
              usuarios, encuestas, eventos, etc.) y se reemplazarán por los del
              archivo. Esta acción no se puede deshacer.
            </p>
          </div>

          {backupMessage && (
            <p className="text-sm font-medium text-green-600">{backupMessage}</p>
          )}
          {backupError && (
            <p className="text-sm font-medium text-destructive">{backupError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
