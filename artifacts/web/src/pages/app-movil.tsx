import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useGetMobileApp } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Smartphone, Copy, Check, Download, Bell } from "lucide-react";

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast({ title: "Enlace copiado" });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "No se pudo copiar",
        description: "Copia el enlace manualmente.",
        variant: "destructive",
      });
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-2 shrink-0" onClick={onCopy}>
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copiado" : "Copiar"}
    </Button>
  );
}

function QrPanel({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-6 text-center">
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <QRCodeSVG value={value} size={208} level="M" includeMargin={false} />
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex w-full items-center gap-2 rounded-md bg-muted px-3 py-2">
        <code className="flex-1 truncate text-left text-xs text-muted-foreground">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function AppMovilPage() {
  const { data, isLoading } = useGetMobileApp();

  const webUrl = data?.webUrl;
  const iosUrl = data?.iosUrl;
  const androidUrl = data?.androidUrl;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">App Móvil</h1>
        <p className="text-muted-foreground">
          Instala Coordina ADG en tu teléfono escaneando el código QR. No
          necesitas ninguna tienda de aplicaciones.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">
          Cargando información de acceso...
        </p>
      ) : (
        <div className="space-y-6">
          {/* Native store links (shown only when published to the stores) */}
          {(iosUrl || androidUrl) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Smartphone className="h-5 w-5" />
                  Instalar desde la tienda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6 sm:grid-cols-2">
                  {iosUrl && (
                    <QrPanel
                      title="iOS"
                      description="Escanea con la cámara del iPhone para instalar."
                      value={iosUrl}
                    />
                  )}
                  {androidUrl && (
                    <QrPanel
                      title="Android"
                      description="Escanea con la cámara del móvil para instalar."
                      value={androidUrl}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Installable web app (PWA) */}
          {webUrl ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Download className="h-5 w-5" />
                  Instalar la app web
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
                  <QrPanel
                    title="Abrir en el móvil"
                    description="Escanea este código con la cámara del teléfono."
                    value={webUrl}
                  />
                  <ol className="space-y-4 text-sm">
                    <Step n={1}>
                      Escanea el código QR con la{" "}
                      <span className="font-semibold">cámara</span> del teléfono
                      (o abre el enlace en el navegador del móvil).
                    </Step>
                    <Step n={2}>
                      Para instalarla como una app:{" "}
                      <span className="font-semibold">en iPhone</span> pulsa{" "}
                      <span className="font-semibold">Compartir</span> →{" "}
                      <span className="font-semibold">
                        Añadir a pantalla de inicio
                      </span>
                      ;{" "}
                      <span className="font-semibold">en Android</span> usa el
                      menú del navegador →{" "}
                      <span className="font-semibold">Instalar app</span> (o el
                      botón <span className="font-semibold">Instalar app</span>{" "}
                      dentro de la aplicación).
                    </Step>
                    <Step n={3}>
                      Inicia sesión con tus mismas credenciales del panel web.
                    </Step>
                  </ol>
                </div>
                <div className="flex items-start gap-3 rounded-md border bg-muted/50 p-4 text-sm text-muted-foreground">
                  <Bell className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Al instalarla, la app puede pedirte permiso para enviarte{" "}
                    <span className="font-medium text-foreground">
                      notificaciones del navegador
                    </span>
                    , de modo que recibas avisos de mensajes y alertas aunque no
                    la tengas abierta.
                  </span>
                </div>
              </CardContent>
            </Card>
          ) : (
            !iosUrl &&
            !androidUrl && (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  El acceso a la app móvil no está disponible en este momento.
                </CardContent>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}
