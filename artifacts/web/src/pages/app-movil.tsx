import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useGetMobileApp } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Smartphone, Apple, Copy, Check, QrCode } from "lucide-react";

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

export default function AppMovilPage() {
  const { data, isLoading } = useGetMobileApp();

  const expoGoUrl = data?.expoGoUrl;
  const iosUrl = data?.iosUrl;
  const androidUrl = data?.androidUrl;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">App Móvil</h1>
        <p className="text-muted-foreground">
          Instala Coordina ADG en tu teléfono escaneando un código QR.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando información de acceso...</p>
      ) : (
        <div className="space-y-6">
          {/* Production install links (shown only when published) */}
          {(iosUrl || androidUrl) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Smartphone className="h-5 w-5" />
                  Instalar la app
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

          {/* Expo Go development access */}
          {expoGoUrl ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <QrCode className="h-5 w-5" />
                  Acceso mediante Expo Go
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
                  <QrPanel
                    title="Abrir en Expo Go"
                    description="Escanea este código para abrir la app en tu teléfono."
                    value={expoGoUrl}
                  />
                  <ol className="space-y-4 text-sm">
                    <li className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        1
                      </span>
                      <span>
                        Instala la aplicación gratuita{" "}
                        <span className="font-semibold">Expo Go</span> en tu teléfono
                        desde la App Store (iOS) o Google Play (Android).
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        2
                      </span>
                      <span>
                        En <span className="font-semibold">iPhone</span>, escanea el QR
                        con la cámara. En <span className="font-semibold">Android</span>,
                        ábrelo desde la propia app Expo Go con la opción "Scan QR code".
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                        3
                      </span>
                      <span>
                        Inicia sesión con tus mismas credenciales del panel web.
                      </span>
                    </li>
                  </ol>
                </div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <a
                      href="https://apps.apple.com/app/expo-go/id982107779"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Apple className="h-4 w-4" />
                      Expo Go (iOS)
                    </a>
                  </Button>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="gap-2"
                  >
                    <a
                      href="https://play.google.com/store/apps/details?id=host.exp.exponent"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Smartphone className="h-4 w-4" />
                      Expo Go (Android)
                    </a>
                  </Button>
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
