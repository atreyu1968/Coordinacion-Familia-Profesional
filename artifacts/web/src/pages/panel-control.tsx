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
  FolderKanban,
  BookText,
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
  const [mobileWebUrl, setMobileWebUrl] = useState("");
  const [nextcloudUrl, setNextcloudUrl] = useState("");
  const [collaboraUrl, setCollaboraUrl] = useState("");
  const [nextcloudAdminUser, setNextcloudAdminUser] = useState("");
  const [nextcloudAdminPassword, setNextcloudAdminPassword] = useState("");
  const [nextcloudOidcClientId, setNextcloudOidcClientId] = useState("");
  const [nextcloudOidcClientSecret, setNextcloudOidcClientSecret] = useState("");
  const [outlineUrl, setOutlineUrl] = useState("");
  const [outlineOidcClientId, setOutlineOidcClientId] = useState("");
  const [outlineOidcClientSecret, setOutlineOidcClientSecret] = useState("");
  const [outlineApiToken, setOutlineApiToken] = useState("");
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

  useEffect(() => {
    if (settings?.mobileWebUrl) {
      setMobileWebUrl(settings.mobileWebUrl);
    }
  }, [settings?.mobileWebUrl]);

  useEffect(() => {
    if (settings?.nextcloudUrl) setNextcloudUrl(settings.nextcloudUrl);
  }, [settings?.nextcloudUrl]);

  useEffect(() => {
    if (settings?.collaboraUrl) setCollaboraUrl(settings.collaboraUrl);
  }, [settings?.collaboraUrl]);

  useEffect(() => {
    if (settings?.nextcloudAdminUser)
      setNextcloudAdminUser(settings.nextcloudAdminUser);
  }, [settings?.nextcloudAdminUser]);

  useEffect(() => {
    if (settings?.nextcloudOidcClientId)
      setNextcloudOidcClientId(settings.nextcloudOidcClientId);
  }, [settings?.nextcloudOidcClientId]);

  useEffect(() => {
    if (settings?.outlineUrl) setOutlineUrl(settings.outlineUrl);
  }, [settings?.outlineUrl]);

  useEffect(() => {
    if (settings?.outlineOidcClientId)
      setOutlineOidcClientId(settings.outlineOidcClientId);
  }, [settings?.outlineOidcClientId]);

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
      mobileWebUrl?: string;
      nextcloudUrl?: string;
      collaboraUrl?: string;
      nextcloudAdminUser?: string;
      nextcloudAdminPassword?: string;
      nextcloudOidcClientId?: string;
      nextcloudOidcClientSecret?: string;
      outlineUrl?: string;
      outlineOidcClientId?: string;
      outlineOidcClientSecret?: string;
      outlineApiToken?: string;
    } = {};
    if (deepseekApiKey.trim()) payload.deepseekApiKey = deepseekApiKey.trim();
    if (resendApiKey.trim()) payload.resendApiKey = resendApiKey.trim();
    if (resendFromEmail.trim()) payload.resendFromEmail = resendFromEmail.trim();
    if (jaasAppId.trim()) payload.jaasAppId = jaasAppId.trim();
    if (jaasKid.trim()) payload.jaasKid = jaasKid.trim();
    if (jaasPrivateKey.trim()) payload.jaasPrivateKey = jaasPrivateKey.trim();
    if (mobileWebUrl !== (settings?.mobileWebUrl ?? "")) {
      payload.mobileWebUrl = mobileWebUrl.trim();
    }
    if (nextcloudUrl !== (settings?.nextcloudUrl ?? "")) {
      payload.nextcloudUrl = nextcloudUrl.trim();
    }
    if (collaboraUrl !== (settings?.collaboraUrl ?? "")) {
      payload.collaboraUrl = collaboraUrl.trim();
    }
    if (nextcloudAdminUser !== (settings?.nextcloudAdminUser ?? "")) {
      payload.nextcloudAdminUser = nextcloudAdminUser.trim();
    }
    if (nextcloudAdminPassword.trim()) {
      payload.nextcloudAdminPassword = nextcloudAdminPassword.trim();
    }
    if (nextcloudOidcClientId !== (settings?.nextcloudOidcClientId ?? "")) {
      payload.nextcloudOidcClientId = nextcloudOidcClientId.trim();
    }
    if (nextcloudOidcClientSecret.trim()) {
      payload.nextcloudOidcClientSecret = nextcloudOidcClientSecret.trim();
    }
    if (outlineUrl !== (settings?.outlineUrl ?? "")) {
      payload.outlineUrl = outlineUrl.trim();
    }
    if (outlineOidcClientId !== (settings?.outlineOidcClientId ?? "")) {
      payload.outlineOidcClientId = outlineOidcClientId.trim();
    }
    if (outlineOidcClientSecret.trim()) {
      payload.outlineOidcClientSecret = outlineOidcClientSecret.trim();
    }
    if (outlineApiToken.trim()) {
      payload.outlineApiToken = outlineApiToken.trim();
    }

    try {
      await updateMutation.mutateAsync({ data: payload });
      setDeepseekApiKey("");
      setResendApiKey("");
      setJaasKid("");
      setJaasPrivateKey("");
      setNextcloudAdminPassword("");
      setNextcloudOidcClientSecret("");
      setOutlineOidcClientSecret("");
      setOutlineApiToken("");
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

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                Espacio colaborativo (Nextcloud)
              </CardTitle>
            </div>
            <StatusBadge active={!!settings?.nextcloudConfigured} />
          </CardHeader>
          <CardContent>
            <CardDescription>
              Carpetas compartidas por módulo y edición de documentos en tiempo
              real (Collabora) con inicio de sesión único. Requiere la URL de
              Nextcloud, las credenciales de administración y el cliente OIDC.
            </CardDescription>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <BookText className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">
                Documentación (Outline)
              </CardTitle>
            </div>
            <StatusBadge active={!!settings?.outlineConfigured} />
          </CardHeader>
          <CardContent>
            <CardDescription>
              Wiki de documentación por módulo con inicio de sesión único.
              Requiere su propio subdominio (no admite subcarpeta), la URL de
              Outline, el cliente OIDC y un token de API.
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

            <div className="space-y-2">
              <Label htmlFor="mobileWebUrl">URL pública de la app móvil</Label>
              <Input
                id="mobileWebUrl"
                type="url"
                placeholder="https://tu-dominio.com"
                value={mobileWebUrl}
                onChange={(e) => setMobileWebUrl(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Dirección HTTPS por la que se accede a la plataforma. Activa la
                página «App Móvil» y su código QR de instalación. Si la dejas
                vacía, se usará la URL configurada en el servidor durante la
                instalación (si existe).
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <FolderKanban className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">
                  Espacio colaborativo (Nextcloud + Collabora)
                </h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nextcloudUrl">URL de Nextcloud</Label>
                  <Input
                    id="nextcloudUrl"
                    type="url"
                    placeholder="https://tu-dominio.com/nextcloud"
                    value={nextcloudUrl}
                    onChange={(e) => setNextcloudUrl(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="collaboraUrl">URL de Collabora</Label>
                  <Input
                    id="collaboraUrl"
                    type="url"
                    placeholder="https://tu-dominio.com/collabora"
                    value={collaboraUrl}
                    onChange={(e) => setCollaboraUrl(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nextcloudAdminUser">
                    Usuario administrador de Nextcloud
                  </Label>
                  <Input
                    id="nextcloudAdminUser"
                    placeholder="admin"
                    value={nextcloudAdminUser}
                    onChange={(e) => setNextcloudAdminUser(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nextcloudAdminPassword">
                    Contraseña del administrador
                  </Label>
                  <Input
                    id="nextcloudAdminPassword"
                    type="password"
                    placeholder={
                      settings?.nextcloudAdminPasswordConfigured
                        ? "•••••••• (sin cambios)"
                        : "Contraseña de administración"
                    }
                    value={nextcloudAdminPassword}
                    onChange={(e) => setNextcloudAdminPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nextcloudOidcClientId">
                    Client ID (OIDC)
                  </Label>
                  <Input
                    id="nextcloudOidcClientId"
                    placeholder="coordina-nextcloud"
                    value={nextcloudOidcClientId}
                    onChange={(e) => setNextcloudOidcClientId(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="nextcloudOidcClientSecret">
                    Client Secret (OIDC)
                  </Label>
                  <Input
                    id="nextcloudOidcClientSecret"
                    type="password"
                    placeholder={
                      settings?.nextcloudOidcClientSecretConfigured
                        ? "•••••••• (sin cambios)"
                        : "Secreto del cliente OIDC"
                    }
                    value={nextcloudOidcClientSecret}
                    onChange={(e) =>
                      setNextcloudOidcClientSecret(e.target.value)
                    }
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Las contraseñas y secretos no se muestran nunca: déjalos en
                blanco para conservar el valor guardado. El cliente OIDC debe
                registrarse en Nextcloud (app «user_oidc») apuntando a esta
                plataforma como proveedor de identidad.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <BookText className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Documentación (Outline)</h3>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="outlineUrl">URL de Outline</Label>
                  <Input
                    id="outlineUrl"
                    type="url"
                    placeholder="https://docs.tu-dominio.com"
                    value={outlineUrl}
                    onChange={(e) => setOutlineUrl(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="outlineApiToken">Token de API</Label>
                  <Input
                    id="outlineApiToken"
                    type="password"
                    placeholder={
                      settings?.outlineApiTokenConfigured
                        ? "•••••••• (sin cambios)"
                        : "Token de API de Outline"
                    }
                    value={outlineApiToken}
                    onChange={(e) => setOutlineApiToken(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="outlineOidcClientId">Client ID (OIDC)</Label>
                  <Input
                    id="outlineOidcClientId"
                    placeholder="coordina-outline"
                    value={outlineOidcClientId}
                    onChange={(e) => setOutlineOidcClientId(e.target.value)}
                    autoComplete="off"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="outlineOidcClientSecret">
                    Client Secret (OIDC)
                  </Label>
                  <Input
                    id="outlineOidcClientSecret"
                    type="password"
                    placeholder={
                      settings?.outlineOidcClientSecretConfigured
                        ? "•••••••• (sin cambios)"
                        : "Secreto del cliente OIDC"
                    }
                    value={outlineOidcClientSecret}
                    onChange={(e) => setOutlineOidcClientSecret(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Outline aloja la wiki de documentación de cada módulo. Requiere
                su propio subdominio (no admite subcarpeta). Configura Outline
                con esta plataforma como único proveedor de identidad (OIDC)
                para que el profesorado entre sin volver a iniciar sesión. El
                token de API permite crear colecciones y gestionar editores.
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
