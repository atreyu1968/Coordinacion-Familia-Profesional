import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMeetingAiSettings,
  useUpdateMeetingAiSettings,
  getGetMeetingAiSettingsQueryKey,
  type MeetingAiSettingsInput,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpenCheck, CheckCircle2, XCircle } from "lucide-react";

function Pill({ ok, on, off }: { ok: boolean; on: string; off: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
      <CheckCircle2 className="h-3.5 w-3.5" /> {on}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <XCircle className="h-3.5 w-3.5" /> {off}
    </span>
  );
}

export function MeetingAiSettingsCard() {
  const qc = useQueryClient();
  const { data: s, isLoading, error, refetch } = useGetMeetingAiSettings();
  const mut = useUpdateMeetingAiSettings();
  const [apiKey, setApiKey] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (s) {
      setTranscriptionModel(s.transcriptionModel);
      setVisionModel(s.visionModel);
    }
  }, [s?.transcriptionModel, s?.visionModel]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (data: MeetingAiSettingsInput, ok: string) => {
    setMsg(null);
    setErr(null);
    try {
      const saved = await mut.mutateAsync({ data });
      qc.setQueryData(getGetMeetingAiSettingsQueryKey(), saved);
      setApiKey("");
      setMsg(ok);
    } catch {
      setErr("No se pudo guardar la configuración de actas.");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const data: MeetingAiSettingsInput = {};
    if (apiKey.trim()) data.apiKey = apiKey.trim();
    if (transcriptionModel.trim() && transcriptionModel.trim() !== s?.transcriptionModel) data.transcriptionModel = transcriptionModel.trim();
    if (visionModel.trim() && visionModel.trim() !== s?.visionModel) data.visionModel = visionModel.trim();
    if (Object.keys(data).length === 0) {
      setMsg("No hay cambios que guardar.");
      return;
    }
    void submit(data, "Configuración de actas guardada.");
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Actas de reuniones con IA</CardTitle>
          </div>
          {s && (
            <div className="flex flex-wrap gap-1.5">
              <Pill ok={s.writingConfigured} on="Redacción lista" off="Sin redacción" />
              <Pill ok={s.apiKeyConfigured || s.managedAvailable} on="Multimedia lista" off="Sin multimedia" />
              <Pill ok={s.processingAvailable} on="Procesado disponible" off="Sin procesado" />
            </div>
          )}
        </div>
        <CardDescription className="space-y-1.5">
          <span className="block">
            Si está configurado, DeepSeek redacta y revisa las actas. Si no, se utiliza OpenAI, que también transcribe audio y vídeo y analiza imágenes y PDF escaneados.
          </span>
          <span className="block">
            En Replit puede usarse la integración gestionada sin clave propia. En un servidor propio hace falta una clave de OpenAI y tener instalados ffmpeg y poppler (el instalador se encarga de los paquetes).
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : error ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">No se pudo cargar la configuración de actas.</p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>Reintentar</Button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {s?.managedAvailable && !s.apiKeyConfigured && (
              <p className="rounded-md border border-primary/25 bg-primary/5 p-3 text-xs">
                Usando la integración gestionada de OpenAI del entorno Replit. Añade una clave solo si quieres usar la tuya.
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="meetingAiKey">Clave API de OpenAI</Label>
              <Input
                id="meetingAiKey"
                type="password"
                autoComplete="new-password"
                placeholder={s?.apiKeyConfigured ? "•••••••• (sin cambios)" : "sk-..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                data-testid="input-meeting-ai-key"
              />
              <p className="text-xs text-muted-foreground">La clave nunca se muestra. Déjala vacía para conservar la actual.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="meetingAiTranscription">Modelo de transcripción</Label>
                <Input id="meetingAiTranscription" value={transcriptionModel} maxLength={100} onChange={(e) => setTranscriptionModel(e.target.value)} data-testid="input-transcription-model" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="meetingAiVision">Modelo de visión</Label>
                <Input id="meetingAiVision" value={visionModel} maxLength={100} onChange={(e) => setVisionModel(e.target.value)} data-testid="input-vision-model" />
              </div>
            </div>
            {msg && <p className="text-sm font-medium text-green-600">{msg}</p>}
            {err && <p className="text-sm font-medium text-destructive">{err}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={mut.isPending} data-testid="button-save-meeting-ai">
                {mut.isPending ? "Guardando..." : "Guardar actas IA"}
              </Button>
              {s?.apiKeyConfigured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={mut.isPending}
                  onClick={() => {
                    if (window.confirm("¿Eliminar la clave de OpenAI guardada?")) void submit({ clearApiKey: true }, "Clave eliminada.");
                  }}
                  data-testid="button-clear-meeting-ai-key"
                >
                  Eliminar clave
                </Button>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
