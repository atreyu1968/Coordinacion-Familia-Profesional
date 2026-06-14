import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListReports,
  useGenerateReport,
  useListProvinces,
  getListReportsQueryKey,
  type AnnualReport,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
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
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { exportTextPdf } from "@/lib/export";
import { FileText, Sparkles, FileDown, Eye, AlertTriangle } from "lucide-react";

const GLOBAL = "global";

function defaultSchoolYear(): string {
  const now = new Date();
  const year = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

function ambitoLabel(report: AnnualReport, provinceName?: string): string {
  if (report.provinceId == null) return "Autonómica";
  return provinceName ?? `Provincia ${report.provinceId}`;
}

export default function MemoriasPage() {
  const { user } = useAuth();
  const { professionalFamily } = useBranding();
  const qc = useQueryClient();
  const isSuperadmin = user?.role === "superadmin";
  const canGenerate = isSuperadmin || user?.role === "coordinator";
  const canAccess = canGenerate;

  const { data: reports = [], isLoading } = useListReports({
    query: { enabled: canAccess, queryKey: getListReportsQueryKey() },
  });
  const { data: provinces = [] } = useListProvinces();
  const generateMut = useGenerateReport();

  const [schoolYear, setSchoolYear] = useState(defaultSchoolYear());
  const [provinceId, setProvinceId] = useState<string>(GLOBAL);
  const [notConfigured, setNotConfigured] = useState(false);
  const [viewing, setViewing] = useState<AnnualReport | null>(null);

  const provinceName = (id: number | null | undefined) =>
    provinces.find((p) => p.id === id)?.name;

  const onGenerate = async () => {
    if (!schoolYear.trim()) {
      toast({ title: "Indica el curso académico", variant: "destructive" });
      return;
    }
    setNotConfigured(false);
    try {
      const report = await generateMut.mutateAsync({
        data: {
          schoolYear: schoolYear.trim(),
          provinceId:
            isSuperadmin && provinceId !== GLOBAL ? Number(provinceId) : null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListReportsQueryKey() });
      toast({
        title: "Memoria generada",
        description: `Curso ${report.schoolYear}`,
      });
      setViewing(report);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 503) {
        setNotConfigured(true);
        return;
      }
      toast({
        title: "No se pudo generar la memoria",
        description: "Inténtalo de nuevo más tarde.",
        variant: "destructive",
      });
    }
  };

  const onExport = (report: AnnualReport) => {
    exportTextPdf(
      `Memoria anual ${report.schoolYear} — ${ambitoLabel(report, provinceName(report.provinceId))}`,
      report.content,
      `memoria-adg-${report.schoolYear}.pdf`,
    );
  };

  if (!canAccess) {
    return (
      <div className="max-w-xl rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-2 text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Acceso restringido</p>
            <p className="text-sm text-muted-foreground">
              Las memorias solo están disponibles para los coordinadores
              provinciales y el superadministrador.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Memorias anuales</h1>
        <p className="text-muted-foreground">
          Genera y consulta memorias institucionales de la familia profesional
          de {professionalFamily}, redactadas con IA a partir de los datos
          de la plataforma.
        </p>
      </div>

      {canGenerate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              Generar nueva memoria
            </CardTitle>
            <CardDescription>
              {isSuperadmin
                ? "Selecciona el ámbito y el curso académico."
                : "Se generará para el ámbito de tu coordinación provincial."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="schoolYear">Curso académico</Label>
                <Input
                  id="schoolYear"
                  className="w-[180px]"
                  value={schoolYear}
                  onChange={(e) => setSchoolYear(e.target.value)}
                  placeholder="2025-2026"
                />
              </div>
              {isSuperadmin && (
                <div className="space-y-1.5">
                  <Label>Ámbito</Label>
                  <Select value={provinceId} onValueChange={setProvinceId}>
                    <SelectTrigger className="w-[230px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={GLOBAL}>
                        Autonómica (toda Canarias)
                      </SelectItem>
                      {provinces.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button onClick={onGenerate} disabled={generateMut.isPending}>
                <Sparkles className="mr-2 h-4 w-4" />
                {generateMut.isPending ? "Generando…" : "Generar memoria"}
              </Button>
            </div>

            {notConfigured && (
              <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  El generador de memorias está{" "}
                  <strong>pendiente de configuración</strong>. Un administrador
                  debe añadir la clave de DeepSeek en los ajustes de
                  integraciones para activar la redacción automática.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Memorias generadas</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <FileText className="h-8 w-8" />
              <p>Aún no hay memorias generadas.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {reports.map((report) => (
              <Card key={report.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        Curso {report.schoolYear}
                      </span>
                      <Badge variant="secondary">
                        {ambitoLabel(report, provinceName(report.provinceId))}
                      </Badge>
                      <Badge variant="outline">
                        {report.status === "final" ? "Final" : "Borrador"}
                      </Badge>
                    </div>
                    {report.generatedAt && (
                      <p className="text-xs text-muted-foreground">
                        Generada el{" "}
                        {new Date(report.generatedAt).toLocaleDateString(
                          "es-ES",
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewing(report)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Ver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onExport(report)}
                    >
                      <FileDown className="mr-2 h-4 w-4" />
                      PDF
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Memoria anual {viewing?.schoolYear} —{" "}
              {viewing
                ? ambitoLabel(viewing, provinceName(viewing.provinceId))
                : ""}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {viewing.content}
              </div>
              <div className="flex justify-end pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onExport(viewing)}
                >
                  <FileDown className="mr-2 h-4 w-4" />
                  Exportar PDF
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
