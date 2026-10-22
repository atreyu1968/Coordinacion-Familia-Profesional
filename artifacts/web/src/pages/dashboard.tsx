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
  exportSheetsXlsx,
  type ExportSheet,
} from "@/lib/export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const GLOBAL = "global";
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
  const [provinceFilter, setProvinceFilter] = useState<string>(GLOBAL);

  const params =
    isSuperadmin && provinceFilter !== GLOBAL
      ? { provinceId: Number(provinceFilter) }
      : undefined;

  const summaryQuery = useGetDashboardSummary(params, {
    query: {
      queryKey: getGetDashboardSummaryQueryKey(params),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const statsQuery = useGetDashboardStatistics(params, {
    query: {
      queryKey: getGetDashboardStatisticsQueryKey(params),
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
    },
  });
  const { data: summary } = summaryQuery;
  const { data: stats } = statsQuery;
  const isRefreshing = summaryQuery.isFetching || statsQuery.isFetching;
  const latestDataUpdatedAt = Math.max(
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
  const canViewUserDirectory =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head" ||
    user?.role === "teacher";

  const cards = [
    { label: "Centros", value: summary?.centers, icon: Building2, href: dashboardHref("/centros", { dashboard: "centers" }) },
    {
      label: "Profesorado",
      value: summary?.teachers,
      icon: Users,
      href: canViewUserDirectory
        ? dashboardHref("/usuarios", { dashboard: "users", role: "teacher", status: "active" })
        : undefined,
    },
    { label: "Recursos", value: summary?.resources, icon: FileText, href: dashboardHref("/recursos", { dashboard: "resources" }) },
    {
      label: "Encuestas activas",
      value: summary?.activeSurveys,
      icon: BarChartIcon,
      href: isSuperadmin
        ? dashboardHref("/encuestas", { status: "open" })
        : undefined,
    },
    {
      label: "Próximos eventos",
      value: summary?.upcomingEvents,
      icon: Calendar,
      href: dashboardHref("/eventos", { dashboard: "events", period: "upcoming" }),
    },
    {
      label: "Avisos de empresas",
      value: summary?.companyAlerts,
      icon: Bell,
      href: dashboardHref("/fct", { dashboard: "alerts" }),
    },
  ];

  function dashboardHref(path: string, filters: Record<string, string>) {
    const query = new URLSearchParams(filters);
    if (isSuperadmin && provinceFilter !== GLOBAL) {
      query.set("provinceId", provinceFilter);
    }
    return `${path}?${query.toString()}`;
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
        rows: cards.map((c) => [c.label, c.value ?? 0]),
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
    .replace(/(^-|-$)/g, "")}`;

  const onExportPdf = () =>
    exportTablesPdf(
      `Estadísticas · ${professionalFamily} — ${scopeLabel}`,
      buildSheets(),
      `${fileBase}.pdf`,
    );
  const onExportXlsx = () => exportSheetsXlsx(buildSheets(), `${fileBase}.xlsx`);

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
          <Button variant="outline" size="sm" onClick={onExportPdf}>
            <FileDown className="mr-2 h-4 w-4" />
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={onExportXlsx}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          Datos consultados directamente en la plataforma; actualización
          automática cada minuto.
        </span>
        <span aria-live="polite">
          {isRefreshing
            ? "Actualizando…"
            : lastUpdatedLabel
              ? `Última consulta correcta: ${lastUpdatedLabel}`
              : "Consultando datos…"}
        </span>
      </div>

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
            <Link key={c.label} href={c.href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
                  <p className="mt-1 text-xs text-muted-foreground">Abrir registros</p>
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
          <ChartLinks points={resourcesByMonth} onSelect={(point) =>
            navigate(dashboardHref("/recursos", { dashboard: "resources", month: point.label }))
          } />
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
          <ChartLinks points={eventsByMonth} onSelect={(point) =>
            navigate(dashboardHref("/eventos", { dashboard: "events", month: point.label }))
          } />
        </ChartCard>

        <ChartCard title="Usuarios por rol">
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
          <ChartLinks points={canViewUserDirectory ? usersByRole : []} onSelect={(point) => {
            const role = roleForLabel(point.label);
            if (role) navigate(dashboardHref("/usuarios", { dashboard: "users", role, status: "active" }));
          }} />
        </ChartCard>

        <ChartCard title="Centros por isla">
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
          <ChartLinks points={centersByIsland} onSelect={(point) =>
            navigate(dashboardHref("/centros", { dashboard: "centers", island: point.label }))
          } />
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
          <ChartLinks points={isSuperadmin ? surveysByStatus : []} onSelect={(point) => {
            const status = surveyStatusForLabel(point.label);
            if (status) navigate(dashboardHref("/encuestas", { status }));
          }} />
        </ChartCard>
      </div>
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
