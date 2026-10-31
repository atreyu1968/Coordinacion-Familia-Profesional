import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useGetForumCollaborationTracking, getGetForumCollaborationTrackingQueryKey } from "@workspace/api-client-react";
import { ArrowLeft, Download, RefreshCw, Search, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { TrackingSummary } from "@/components/collab-tracking/summary";
import { ModuleRow } from "@/components/collab-tracking/module-row";
import { STATE_FILTERS, buildCsv, downloadCsv, filterModules, formatDateTime, groupByCycle, type StateFilter } from "@/lib/collab-tracking";

export default function ForosSeguimientoPage() {
  const q = useGetForumCollaborationTracking({
    query: {
      queryKey: getGetForumCollaborationTrackingQueryKey(),
      staleTime: 15000,
      refetchInterval: 60000,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const [search, setSearch] = useState("");
  const [state, setState] = useState<StateFilter>("all");
  const data = q.data;
  const filtered = useMemo(() => (data ? filterModules(data.modules, search, state) : []), [data, search, state]);
  const groups = useMemo(() => groupByCycle(filtered), [filtered]);

  const exportCsv = () => {
    if (!data) return;
    const label = STATE_FILTERS.find((f) => f.value === state)?.label ?? "Todos";
    const desc = `Estado: ${label}; Búsqueda: ${search.trim() || "(ninguna)"}; Módulos: ${filtered.length}`;
    downloadCsv(`seguimiento-intercentros-${data.generatedAt.slice(0, 10)}.csv`, buildCsv(data, filtered, desc));
  };

  return (
    <div className="space-y-6">
      <Link href="/foros" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-foros">
        <ArrowLeft className="w-4 h-4" /> Volver a Foros
      </Link>
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><Activity className="w-5 h-5" /></div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Seguimiento intercentros</h1>
            <p className="text-sm text-muted-foreground">
              {data ? `${data.family}${data.academicYear ? ` · Curso ${data.academicYear}` : ""}` : "Administración y Gestión"} · ordenado por ciclo y nombre, sin ranking.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground" data-testid="text-last-refreshed">
            {data ? `Datos de ${formatDateTime(data.generatedAt)}` : ""}
          </span>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="button-refresh">
            <RefreshCw className={cn("w-4 h-4 mr-1.5", q.isFetching && "animate-spin")} /> Actualizar
          </Button>
          <Button size="sm" onClick={exportCsv} disabled={!data || filtered.length === 0} data-testid="button-export-csv">
            <Download className="w-4 h-4 mr-1.5" /> Informe CSV
          </Button>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-3" role="status">
          <Skeleton className="h-24 w-full" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : q.isError || !data ? (
        <div className="border rounded-lg p-8 text-center space-y-3" data-testid="state-error">
          <p className="font-medium">No se pudo cargar el seguimiento.</p>
          <p className="text-sm text-muted-foreground">Puede que no tengas acceso o que el servicio no esté disponible.</p>
          <Button variant="outline" onClick={() => q.refetch()} data-testid="button-retry">Reintentar</Button>
        </div>
      ) : (
        <>
          <TrackingSummary data={data} />
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative md:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, código o ciclo" className="pl-9" data-testid="input-search-tracking" />
            </div>
            <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Filtrar por estado">
              {STATE_FILTERS.map((f) => (
                <button key={f.value} type="button" role="radio" aria-checked={state === f.value} onClick={() => setState(f.value)}
                  className={cn("px-3 py-1.5 rounded-full border text-xs transition-colors", state === f.value ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted")}
                  data-testid={`filter-${f.value}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {data.modules.length === 0 ? (
            <div className="border border-dashed rounded-lg p-10 text-center text-muted-foreground" data-testid="state-empty">No hay módulos de Administración y Gestión en tu ámbito.</div>
          ) : groups.length === 0 ? (
            <div className="border border-dashed rounded-lg p-10 text-center text-muted-foreground space-y-2" data-testid="state-no-results">
              <p>Ningún módulo coincide con los filtros.</p>
              <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setState("all"); }}>Limpiar filtros</Button>
            </div>
          ) : (
            groups.map(([cycle, mods]) => (
              <section key={cycle} className="space-y-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{cycle} <span className="font-mono">({mods.length})</span></h2>
                {mods.map((m) => <ModuleRow key={m.id} m={m} />)}
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
