import { useState } from "react";
import {
  useGetDashboardSummary,
  useGetDashboardStatistics,
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
} from "lucide-react";
import {
  exportTablesPdf,
  exportSheetsXlsx,
  type ExportSheet,
} from "@/lib/export";

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
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const { data: provinces = [] } = useListProvinces();
  const [provinceFilter, setProvinceFilter] = useState<string>(GLOBAL);

  const params =
    isSuperadmin && provinceFilter !== GLOBAL
      ? { provinceId: Number(provinceFilter) }
      : undefined;

  const { data: summary, isLoading: summaryLoading } =
    useGetDashboardSummary(params);
  const { data: stats } = useGetDashboardStatistics(params);

  const scopeLabel = !isSuperadmin
    ? "Ámbito de tu coordinación"
    : provinceFilter === GLOBAL
      ? "Ámbito autonómico (toda Canarias)"
      : provinces.find((p) => String(p.id) === provinceFilter)?.name ??
        "Provincial";

  const cards = [
    { label: "Centros", value: summary?.centers, icon: Building2 },
    { label: "Profesorado", value: summary?.teachers, icon: Users },
    { label: "Recursos", value: summary?.resources, icon: FileText },
    {
      label: "Encuestas activas",
      value: summary?.activeSurveys,
      icon: BarChartIcon,
    },
    {
      label: "Próximos eventos",
      value: summary?.upcomingEvents,
      icon: Calendar,
    },
    { label: "Avisos de empresas", value: summary?.companyAlerts, icon: Bell },
  ];

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
      `Estadísticas ADG — ${scopeLabel}`,
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              <c.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {summaryLoading ? "—" : (c.value ?? 0)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Recursos compartidos por mes">
          {resourcesByMonth.length === 0 ? (
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
        </ChartCard>

        <ChartCard title="Actividad de eventos por mes">
          {eventsByMonth.length === 0 ? (
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
        </ChartCard>

        <ChartCard title="Usuarios por rol">
          {usersByRole.length === 0 ? (
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
        </ChartCard>

        <ChartCard title="Centros por isla">
          {centersByIsland.length === 0 ? (
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
        </ChartCard>

        <ChartCard title="Encuestas por estado">
          {surveysByStatus.length === 0 ? (
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
