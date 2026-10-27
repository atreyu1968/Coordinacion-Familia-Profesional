import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetDashboardSummary,
  useGetDashboardStatistics,
  getGetDashboardSummaryQueryKey,
  getGetDashboardStatisticsQueryKey,
  useListProvinces,
} from "@workspace/api-client-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { buildDashboardHref, RESOURCE_CARD_HREF } from "@/lib/dashboard-links";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  Users,
  FileText,
  BarChart as BarChartIcon,
  Calendar,
  Bell,
  FileDown,
  FileSpreadsheet,
  RefreshCw,
} from "lucide-react";
import {
  exportTablesPdf,
  createTablesPdfBlob,
  exportSheetsXlsx,
  type ExportSheet,
} from "@/lib/export";
import { PdfPreviewDialog } from "@/components/pdf-preview-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { useAcademicYears } from "@/components/year-selector";

const GLOBAL = "global";
const ALL_PERIODS = "all";
const CUSTOM_PERIOD = "custom";
const PALETTE = [
  "hsl(217 91% 60%)",
  "hsl(160 84% 39%)",
  "hsl(38 92% 50%)",
  "hsl(280 65% 60%)",
  "hsl(0 84% 60%)",
  "hsl(199 89% 48%)",
];

type Point = { label: string; value: number };

export default function DashboardPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { professionalFamily } = useBranding();
  const isSuperadmin = user?.role === "superadmin";
  const { data: provinces = [] } = useListProvinces();
  const {
    years,
    activeYear,
    isLoading: academicYearsLoading,
  } = useAcademicYears();
  const [provinceFilter, setProvinceFilter] = useState<string>(GLOBAL);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const activeYearRange = activeYear ? academicYearDateRange(activeYear) : null;
  const periodSelection =
    selectedPeriod ??
    (activeYearRange ? `year:${activeYear}` : ALL_PERIODS);
  const selectedYear =
    periodSelection.startsWith("year:")
      ? periodSelection.slice("year:".length)
      : null;
  const selectedRange =
    selectedYear != null
      ? academicYearDateRange(selectedYear)
      : periodSelection === CUSTOM_PERIOD
        ? { startDate: customStartDate, endDate: customEndDate }
        : null;
  const hasValidPeriod =
    selectedRange == null ||
    (isValidDateInput(selectedRange.startDate) &&
      isValidDateInput(selectedRange.endDate) &&
      selectedRange.startDate <= selectedRange.endDate);
  const periodReady = !academicYearsLoading && hasValidPeriod;

  const params = {
    ...(isSuperadmin && provinceFilter !== GLOBAL
      ? { provinceId: Number(provinceFilter) }
      : {}),
    ...(selectedRange && periodReady
      ? {
          startDate: selectedRange.startDate,
          endDate: selectedRange.endDate,
        }
      : {}),
  };
  const queryParams = Object.keys(params).length > 0 ? params : undefined;

  const summaryQuery = useGetDashboardSummary(queryParams, {
    query: {
      queryKey: getGetDashboardSummaryQueryKey(queryParams),
      enabled: periodReady,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: 30_000,
      refetchOnWindowFocus: "always",
    },
  });
  const statsQuery = useGetDashboardStatistics(queryParams, {
    query: {
      queryKey: getGetDashboardStatisticsQueryKey(queryParams),
      enabled: periodReady,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: 30_000,
      refetchOnWindowFocus: "always",
    },
  });
  const { data: summary } = summaryQuery;
  const { data: stats } = statsQuery;
  const canExport = periodReady && !!summary && !!stats &&
    !summaryQuery.isError && !statsQuery.isError;
  const isRefreshing = summaryQuery.isFetching || statsQuery.isFetching;
  const latestDataUpdatedAt = Math.min(
    summaryQuery.dataUpdatedAt,
    statsQuery.dataUpdatedAt,
  );
  const lastUpdatedLabel = latestDataUpdatedAt
    ? new Intl.DateTimeFormat("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(latestDataUpdatedAt)
    : null;

  const refreshDashboard = async () => {
    await Promise.all([summaryQuery.refetch(), statsQuery.refetch()]);
  };

  const scopeLabel = !isSuperadmin
    ? "Ámbito de tu coordinación"
    : provinceFilter === GLOBAL
      ? "Ámbito autonómico (toda Canarias)"
      : provinces.find((p) => String(p.id) === provinceFilter)?.name ??
        "Provincial";
  const periodLabel =
    selectedYear && selectedRange
      ? `Curso ${selectedYear} · ${formatPeriodDate(selectedRange.startDate)} – ${formatPeriodDate(selectedRange.endDate)}`
      : periodSelection === CUSTOM_PERIOD && hasValidPeriod && selectedRange
        ? `Del ${formatPeriodDate(selectedRange.startDate)} al ${formatPeriodDate(selectedRange.endDate)}`
        : periodSelection === CUSTOM_PERIOD
          ? "Selecciona las dos fechas"
          : "Todos los periodos";
  const isPeriodFiltered = selectedRange != null;
  const canViewUserDirectory =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head" ||
    user?.role === "teacher";

  const cards = [
    {
      label: "Centros de la red",
      value: summary?.centers,
      icon: Building2,
      href: dashboardHref("/centros", { dashboard: "centers" }),
    },
    {
      label: "Usuarios activos",
      value: summary?.users,
      icon: Users,
      href: canViewUserDirectory
        ? dashboardHref("/usuarios", {
            dashboard: "users",
            status: "active",
          })
        : undefined,
    },
    {
      label: isPeriodFiltered ? "Recursos del periodo" : "Recursos",
      description: isPeriodFiltered
        ? "Recuento del periodo; abre el repositorio completo"
        : "Abrir repositorio completo",
      value: summary?.resources,
      icon: FileText,
      href: RESOURCE_CARD_HREF,
    },
    {
      label: isPeriodFiltered ? "Encuestas abiertas del periodo" : "Encuestas abiertas",
      value: summary?.activeSurveys,
      icon: BarChartIcon,
      href: dashboardHref("/encuestas", { status: "open" }),
    },
    {
      label: isPeriodFiltered ? "Eventos del periodo" : "Próximos eventos",
      value: summary?.upcomingEvents,
      icon: Calendar,
      href: dashboardHref(
        "/eventos",
        isPeriodFiltered
          ? { dashboard: "events" }
          : { dashboard: "events", period: "upcoming" },
      ),
    },
    {
      label: isPeriodFiltered ? "Avisos de empresas del periodo" : "Avisos de empresas",
      value: summary?.companyAlerts,
      icon: Bell,
      href: dashboardHref("/fct", { dashboard: "alerts" }),
    },
  ];

  function dashboardHref(path: string, filters: Record<string, string>) {
    return buildDashboardHref(
      path,
      filters,
      isSuperadmin && provinceFilter !== GLOBAL ? Number(provinceFilter) : undefined,
      selectedRange && hasValidPeriod ? selectedRange : undefined,
    );
  }

  const usersByRole = (stats?.usersByRole ?? []) as Point[];
  const centersByIsland = (stats?.centersByIsland ?? []) as Point[];
  const resourcesByMonth = (stats?.resourcesByMonth ?? []) as Point[];
  const eventsByMonth = (stats?.eventsByMonth ?? []) as Point[];
  const surveysByStatus = (stats?.surveysByStatus ?? []) as Point[];

  const buildSheets = (): ExportSheet[] => {
    const toRows = (pts: Point[]) =>
      pts.map((p) => [p.label, p.value] as (string | number)[]);
    return [
      {
        name: "Resumen",
        columns: ["Indicador", "Valor"],
        rows: cards.map((c) => [c.label, c.value ?? "Sin datos"]),
      },
      {
        name: "Criterios",
        columns: ["Criterio", "Descripción"],
        rows: [
          ["Ámbito", scopeLabel],
          ["Periodo de actividad", periodLabel],
          ["Centros y usuarios", "Totales actuales, incluidos los dados de alta en cursos anteriores; no es una instantánea histórica."],
        ],
      },
      { name: "Usuarios por rol", columns: ["Rol", "Total"], rows: toRows(usersByRole) },
      {
        name: "Centros por isla",
        columns: ["Isla", "Centros"],
        rows: toRows(centersByIsland),
      },
      {
        name: "Recursos por mes",
        columns: ["Mes", "Recursos"],
        rows: toRows(resourcesByMonth),
      },
      {
        name: "Eventos por mes",
        columns: ["Mes", "Eventos"],
        rows: toRows(eventsByMonth),
      },
      {
        name: "Encuestas por estado",
        columns: ["Estado", "Total"],
        rows: toRows(surveysByStatus),
      },
    ];
  };

  const fileBase = `estadisticas-adg-${scopeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}-${periodLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;

  const onExportPdf = () => {
    if (!canExport) return;
    return exportTablesPdf(
      `Estadísticas · ${professionalFamily} — ${scopeLabel} — ${periodLabel}`,
      buildSheets(),
      `${fileBase}.pdf`,
    );
  };
  const onExportXlsx = () => {
    if (!canExport) return;
    return exportSheetsXlsx(buildSheets(), `${fileBase}.xlsx`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Panel Principal</h1>
          <p className="text-muted-foreground">
            Bienvenido/a, {user?.name}. {scopeLabel}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshDashboard()}
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            Actualizar datos
          </Button>
          {isSuperadmin && (
            <Select value={provinceFilter} onValueChange={setProvinceFilter}>
              <SelectTrigger className="w-[230px]" aria-label="Filtrar por ámbito">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL}>Autonómica (toda Canarias)</SelectItem>
                {provinces.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={periodSelection}
            onValueChange={(value) => {
              if (value === CUSTOM_PERIOD) {
                if (selectedRange) {
                  setCustomStartDate(selectedRange.startDate);
                  setCustomEndDate(selectedRange.endDate);
                } else {
                  setCustomStartDate("");
                  setCustomEndDate("");
                }
              }
              setSelectedPeriod(value);
            }}
          >
            <SelectTrigger
              className="w-[220px]"
              aria-label="Filtrar por curso o periodo"
              data-testid="select-dashboard-period"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_PERIODS}>Todos los periodos</SelectItem>
              {years
                .filter((year) => academicYearDateRange(year.name) != null)
                .map((year) => (
                  <SelectItem
                    key={year.id}
                    value={`year:${year.name}`}
                  >
                    Curso {year.name}{year.name === activeYear ? " (activo)" : ""}
                  </SelectItem>
                ))}
              <SelectItem value={CUSTOM_PERIOD}>Intervalo de fechas</SelectItem>
            </SelectContent>
          </Select>
          {periodSelection === CUSTOM_PERIOD && (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
                aria-label="Fecha inicial del periodo"
                data-testid="input-dashboard-period-start"
                className="w-[160px]"
              />
              <span className="text-sm text-muted-foreground">a</span>
              <Input
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
                aria-label="Fecha final del periodo"
                data-testid="input-dashboard-period-end"
                className="w-[160px]"
              />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={onExportPdf} disabled={!canExport}>
            <FileDown className="mr-2 h-4 w-4" />
            PDF
          </Button>
          <PdfPreviewDialog
            title={`Estadísticas · ${professionalFamily} — ${scopeLabel} — ${periodLabel}`}
            disabled={!canExport}
            loadPdf={async () => createTablesPdfBlob(
              `Estadísticas · ${professionalFamily} — ${scopeLabel} — ${periodLabel}`,
              buildSheets(),
            )}
          />
          <Button variant="outline" size="sm" onClick={onExportXlsx} disabled={!canExport}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          Periodo consultado: <strong data-testid="text-dashboard-period">{periodLabel}</strong>.
          Los centros y usuarios muestran los totales actuales, aunque se dieran
          de alta en cursos anteriores. El periodo filtra los recursos, encuestas
          y avisos por fecha de creación, y los eventos por su celebración.
        </span>
        <span aria-live="polite">
          {isRefreshing
            ? "Actualizando…"
            : lastUpdatedLabel
              ? `Última consulta correcta: ${lastUpdatedLabel}`
              : "Consultando datos…"}
        </span>
      </div>

      {!periodReady && (
        <Alert>
          <AlertTitle>Completa el intervalo de fechas</AlertTitle>
          <AlertDescription>
            Selecciona una fecha inicial y final válidas para consultar el panel.
          </AlertDescription>
        </Alert>
      )}

      {(summaryQuery.isError || statsQuery.isError) && (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron actualizar todos los datos</AlertTitle>
          <AlertDescription>
            {summaryQuery.isError &&
              "El resumen no está disponible. "}
            {statsQuery.isError &&
              "Las estadísticas y los gráficos no están disponibles. "}
            Pulsa «Actualizar datos» para volver a intentarlo.
            {lastUpdatedLabel &&
              ` Se conservan los últimos datos correctos de las ${lastUpdatedLabel}.`}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          c.href ? (
            <Link
              key={c.label}
              href={c.href}
              className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {c.label}
                  </CardTitle>
                  <c.icon className="w-4 h-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">
                    {summaryQuery.isLoading
                      ? "—"
                      : summaryQuery.isError && !summary
                        ? "No disponible"
                        : (c.value ?? 0)}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.description ?? "Abrir registros"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ) : (
            <Card key={c.label}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {c.label}
                </CardTitle>
                <c.icon className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {summaryQuery.isLoading
                    ? "—"
                    : summaryQuery.isError && !summary
                      ? "No disponible"
                      : (c.value ?? 0)}
                </div>
              </CardContent>
            </Card>
          )
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Recursos compartidos por mes">
          {statsQuery.isLoading ? (
            <ChartMessage>Consultando datos…</ChartMessage>
          ) : statsQuery.isError && !stats ? (
            <ChartMessage>No se pudieron cargar los datos.</ChartMessage>
          ) : resourcesByMonth.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={resourcesByMonth}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="value"
                  name="Recursos"
                  stroke={PALETTE[0]}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
          <ChartLinks
            points={resourcesByMonth}
            onSelect={(point) =>
              navigate(
                dashboardHref("/recursos", {
                  month: point.label,
                }),
              )
            }
          />
        </ChartCard>

        <ChartCard title="Actividad de eventos por mes">
          {statsQuery.isLoading ? (
            <ChartMessage>Consultando datos…</ChartMessage>
          ) : statsQuery.isError && !stats ? (
            <ChartMessage>No se pudieron cargar los datos.</ChartMessage>
          ) : eventsByMonth.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={eventsByMonth}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" name="Eventos" fill={PALETTE[1]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <ChartLinks
            points={eventsByMonth}
            onSelect={(point) =>
              navigate(
                dashboardHref("/eventos", {
                  dashboard: "events",
                  month: point.label,
                }),
              )
            }
          />
        </ChartCard>

        <ChartCard title="Usuarios activos por rol">
          {statsQuery.isLoading ? (
            <ChartMessage>Consultando datos…</ChartMessage>
          ) : statsQuery.isError && !stats ? (
            <ChartMessage>No se pudieron cargar los datos.</ChartMessage>
          ) : usersByRole.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={usersByRole} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis type="number" allowDecimals={false} fontSize={12} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={140}
                  fontSize={11}
                />
                <Tooltip />
                <Bar dataKey="value" name="Usuarios" fill={PALETTE[3]} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <ChartLinks
            points={canViewUserDirectory ? usersByRole : []}
            onSelect={(point) => {
              const role = roleForLabel(point.label);
              if (role) {
                navigate(
                  dashboardHref("/usuarios", {
                    dashboard: "users",
                    role,
                    status: "active",
                  }),
                );
              }
            }}
          />
        </ChartCard>

        <ChartCard title="Centros de la red por isla">
          {statsQuery.isLoading ? (
            <ChartMessage>Consultando datos…</ChartMessage>
          ) : statsQuery.isError && !stats ? (
            <ChartMessage>No se pudieron cargar los datos.</ChartMessage>
          ) : centersByIsland.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={centersByIsland}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" name="Centros" fill={PALETTE[5]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
          <ChartLinks
            points={centersByIsland}
            onSelect={(point) =>
              navigate(
                dashboardHref("/centros", {
                  dashboard: "centers",
                  island: point.label,
                }),
              )
            }
          />
        </ChartCard>

        <ChartCard title="Encuestas por estado">
          {statsQuery.isLoading ? (
            <ChartMessage>Consultando datos…</ChartMessage>
          ) : statsQuery.isError && !stats ? (
            <ChartMessage>No se pudieron cargar los datos.</ChartMessage>
          ) : surveysByStatus.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={surveysByStatus}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label
                >
                  {surveysByStatus.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
          <ChartLinks
            points={isSuperadmin ? surveysByStatus : []}
            onSelect={(point) => {
              const status = surveyStatusForLabel(point.label);
              if (status) {
                navigate(dashboardHref("/encuestas", { status }));
              }
            }}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
      Sin datos para este ámbito.
    </div>
  );
}

function ChartMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function roleForLabel(label: string): string | null {
  const roles: Record<string, string> = {
    Superadministración: "superadmin",
    Coordinación: "coordinator",
    Prospección: "prospector",
    "Jefatura de departamento": "department_head",
    Profesorado: "teacher",
  };
  return roles[label] ?? null;
}

function surveyStatusForLabel(label: string): string | null {
  const statuses: Record<string, string> = {
    Borrador: "draft",
    Abierta: "open",
    Cerrada: "closed",
  };
  return statuses[label] ?? null;
}

function ChartLinks({
  points,
  onSelect,
}: {
  points: Point[];
  onSelect: (point: Point) => void;
}) {
  if (points.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t pt-2">
      {points.map((point) => (
        <Button
          key={point.label}
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => onSelect(point)}
          aria-label={`Abrir ${point.label}: ${point.value} registros`}
        >
          {point.label} · {point.value}
        </Button>
      ))}
    </div>
  );
}

function academicYearDateRange(
  schoolYear: string,
): { startDate: string; endDate: string } | null {
  const match = /^(\d{4})\/(\d{4})$/.exec(schoolYear);
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return {
    startDate: `${match[1]}-09-01`,
    endDate: `${match[2]}-08-31`,
  };
}

function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function formatPeriodDate(value: string): string {
  if (!isValidDateInput(value)) return value;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
