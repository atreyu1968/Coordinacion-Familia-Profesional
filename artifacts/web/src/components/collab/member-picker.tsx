import { useMemo, useState } from "react";
import type { CollaborativeSpaceCandidates } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Users, Building2, Info } from "lucide-react";

export type MemberSelection = { userIds: number[]; centerIds: number[] };
export const emptySelection: MemberSelection = { userIds: [], centerIds: [] };

export function errorMessage(err: unknown, fallback: string): string {
  const msg =
    err && typeof err === "object" && "data" in err
      ? (err as { data?: { message?: unknown } }).data?.message
      : undefined;
  return typeof msg === "string" && msg.trim() ? msg : fallback;
}

function toggle(list: number[], id: number) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Distinct active user ids covered by a selection (users + current active users of centers). */
export function resolveSelection(
  candidates: CollaborativeSpaceCandidates | undefined,
  sel: MemberSelection,
  excludeIds: Set<number> = new Set(),
) {
  const ids = new Set<number>();
  if (!candidates) return ids;
  const active = candidates.users.filter((u) => u.status === "active");
  const activeIds = new Set(active.map((u) => u.id));
  sel.userIds.forEach((id) => activeIds.has(id) && ids.add(id));
  const centers = new Set(sel.centerIds);
  active.forEach((u) => u.centerId != null && centers.has(u.centerId) && ids.add(u.id));
  excludeIds.forEach((id) => ids.delete(id));
  return ids;
}

export function MemberPicker({
  candidates,
  isLoading,
  isError,
  onRetry,
  value,
  onChange,
  excludeUserIds,
}: {
  candidates: CollaborativeSpaceCandidates | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  value: MemberSelection;
  onChange: (v: MemberSelection) => void;
  excludeUserIds?: Set<number>;
}) {
  const [userQ, setUserQ] = useState("");
  const [centerQ, setCenterQ] = useState("");

  const users = useMemo(() => {
    const t = userQ.trim().toLowerCase();
    const list = candidates?.users ?? [];
    return t
      ? list.filter((u) =>
          [u.name, u.email, u.centerName ?? ""].some((s) => s.toLowerCase().includes(t)),
        )
      : list;
  }, [candidates, userQ]);

  const centers = useMemo(() => {
    const t = centerQ.trim().toLowerCase();
    const list = candidates?.centers ?? [];
    return t ? list.filter((c) => c.name.toLowerCase().includes(t)) : list;
  }, [candidates, centerQ]);

  const centerCounts = useMemo(() => {
    const m = new Map<number, number>();
    candidates?.users.forEach((u) => {
      if (u.status === "active" && u.centerId != null)
        m.set(u.centerId, (m.get(u.centerId) ?? 0) + 1);
    });
    return m;
  }, [candidates]);

  const total = resolveSelection(candidates, value, excludeUserIds).size;

  if (isLoading)
    return (
      <div className="grid gap-3 md:grid-cols-2" data-testid="status-candidates-loading">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    );
  if (isError)
    return (
      <div className="rounded-md border border-destructive/40 p-4 text-sm space-y-2">
        <p>No se pudieron cargar los usuarios y centros disponibles.</p>
        <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry-candidates">
          Reintentar
        </Button>
      </div>
    );

  return (
    <div className="min-w-0 w-full space-y-3">
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-md border">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
            <Users className="w-4 h-4" /> Usuarios
            <span className="ml-auto text-xs text-muted-foreground">
              {value.userIds.length} marcados
            </span>
          </div>
          <div className="p-2 relative">
            <Search className="absolute left-4 top-[18px] w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Nombre, correo o centro"
              value={userQ}
              onChange={(e) => setUserQ(e.target.value)}
              data-testid="input-search-users"
            />
          </div>
          <div className="max-h-56 overflow-y-auto px-2 pb-2 space-y-0.5">
            {users.length === 0 && (
              <p className="text-xs text-muted-foreground p-3 text-center">Sin resultados.</p>
            )}
            {users.map((u) => {
              const already = excludeUserIds?.has(u.id);
              return (
                <label
                  key={u.id}
                  className="flex min-w-0 items-start gap-2 rounded px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                  data-testid={`row-candidate-user-${u.id}`}
                >
                  <Checkbox
                    className="mt-0.5 shrink-0"
                    checked={value.userIds.includes(u.id)}
                    disabled={already}
                    onCheckedChange={() =>
                      onChange({ ...value, userIds: toggle(value.userIds, u.id) })
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words">{u.name}</span>
                    <span className="block text-xs text-muted-foreground break-all">
                      {u.email}
                      {u.centerName ? ` · ${u.centerName}` : ""}
                      {already ? " · ya es miembro" : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 rounded-md border">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
            <Building2 className="w-4 h-4" /> Centros
            <span className="ml-auto text-xs text-muted-foreground">
              {value.centerIds.length} marcados
            </span>
          </div>
          <div className="p-2 relative">
            <Search className="absolute left-4 top-[18px] w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Nombre del centro"
              value={centerQ}
              onChange={(e) => setCenterQ(e.target.value)}
              data-testid="input-search-centers"
            />
          </div>
          <div className="max-h-56 overflow-y-auto px-2 pb-2 space-y-0.5">
            {centers.length === 0 && (
              <p className="text-xs text-muted-foreground p-3 text-center">Sin resultados.</p>
            )}
            {centers.map((c) => (
              <label
                key={c.id}
                className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 hover:bg-muted cursor-pointer text-sm"
                data-testid={`row-candidate-center-${c.id}`}
              >
                <Checkbox
                  className="shrink-0"
                  checked={value.centerIds.includes(c.id)}
                  onCheckedChange={() =>
                    onChange({ ...value, centerIds: toggle(value.centerIds, c.id) })
                  }
                />
                <span className="min-w-0 flex-1 break-words">{c.name}</span>
                <span className="ml-auto text-xs text-muted-foreground shrink-0">
                  {centerCounts.get(c.id) ?? 0} activos
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          <strong className="text-foreground" data-testid="text-selection-total">
            {total} {total === 1 ? "usuario activo distinto" : "usuarios activos distintos"}
          </strong>{" "}
          {excludeUserIds?.size ? "nuevos " : ""}en esta selección. Marcar un centro añade una
          sola vez a sus usuarios activos <em>actuales</em>; quien se incorpore al centro más
          adelante no entrará automáticamente.
        </p>
      </div>
    </div>
  );
}
