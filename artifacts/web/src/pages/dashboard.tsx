import {
  useGetDashboardSummary,
  useGetDashboardStatistics,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Building2, Users, FileText, BarChart, Calendar, Bell } from "lucide-react";

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary();
  const { data: stats } = useGetDashboardStatistics();

  const cards = [
    { label: "Centros", value: summary?.centers, icon: Building2 },
    { label: "Profesorado", value: summary?.teachers, icon: Users },
    { label: "Recursos", value: summary?.resources, icon: FileText },
    { label: "Encuestas activas", value: summary?.activeSurveys, icon: BarChart },
    { label: "Próximos eventos", value: summary?.upcomingEvents, icon: Calendar },
    { label: "Avisos de empresas", value: summary?.companyAlerts, icon: Bell },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Panel Principal</h1>
        <p className="text-muted-foreground">
          Bienvenido/a, {user?.name}. Resumen de la familia profesional de
          Administración y Gestión.
        </p>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usuarios por rol</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(stats?.usersByRole ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            )}
            {(stats?.usersByRole ?? []).map((r) => (
              <div
                key={r.label}
                className="flex items-center justify-between text-sm"
              >
                <span>{r.label}</span>
                <span className="font-semibold">{r.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Centros por isla</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(stats?.centersByIsland ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Sin datos.</p>
            )}
            {(stats?.centersByIsland ?? []).map((r) => (
              <div
                key={r.label}
                className="flex items-center justify-between text-sm"
              >
                <span>{r.label}</span>
                <span className="font-semibold">{r.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
