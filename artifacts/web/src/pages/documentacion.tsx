import { useEffect, useMemo, useState } from "react";
import {
  useListModules,
  useGetWikiStatus,
  useOpenModuleWiki,
  useGetModuleWikiEditors,
  useUpdateModuleWikiEditors,
  getGetModuleWikiEditorsQueryKey,
  type Module,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useModuleParam } from "@/lib/use-module-param";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  BookText,
  ExternalLink,
  X,
  Settings,
  Search,
  Users,
} from "lucide-react";
import { Link } from "wouter";

// ---------------------------------------------------------------------------
// Fullscreen Outline (documentation wiki) overlay — same pattern as the
// collaborative-space overlay.
// ---------------------------------------------------------------------------
function WikiOverlay({
  title,
  url,
  onNewTab,
  onClose,
}: {
  title: string;
  url: string;
  onNewTab: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 h-12 bg-zinc-900 text-white shrink-0">
        <span className="font-medium truncate flex items-center gap-2">
          <BookText className="w-4 h-4" />
          {title}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={onNewTab}
            className="text-sm text-zinc-300 hover:text-white inline-flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Nueva pestaña
          </button>
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-white"
            aria-label="Cerrar la documentación"
          >
            <X className="w-4 h-4" /> Cerrar
          </button>
        </div>
      </div>
      <iframe
        title={title}
        src={url}
        className="flex-1 w-full border-0"
        allow="clipboard-write; fullscreen"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor management dialog. Everyone reads every module's documentation; only
// the users listed here may edit. A superadmin grants to anyone; a module
// coordinator grants to that module's collaborating teachers. Non-managers see
// a read-only message.
// ---------------------------------------------------------------------------
function EditorsDialog({
  module,
  open,
  onOpenChange,
}: {
  module: Module;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useGetModuleWikiEditors(module.id, {
    query: {
      enabled: open,
      queryKey: getGetModuleWikiEditorsQueryKey(module.id),
    },
  });
  const updateMut = useUpdateModuleWikiEditors();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState("");

  // Seed the selection from the server once the data loads / dialog opens.
  useEffect(() => {
    if (open && data) setSelected(new Set(data.editorIds));
    if (!open) setFilter("");
  }, [open, data]);

  const candidates = data?.candidates ?? [];
  const canManage = data?.canManage ?? false;

  const filtered = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.email ?? "").toLowerCase().includes(term),
    );
  }, [candidates, filter]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const label = module.code ? `${module.code} · ${module.name}` : module.name;

  const onSave = async () => {
    try {
      await updateMut.mutateAsync({
        moduleId: module.id,
        data: { userIds: [...selected] },
      });
      toast({ title: "Editores actualizados", description: label });
      onOpenChange(false);
    } catch {
      toast({
        title: "No se pudieron guardar los editores",
        description: "Comprueba tus permisos e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editores de la documentación</DialogTitle>
          <DialogDescription>
            Todo el profesorado puede leer «{label}». Marca quién puede
            editarla.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Cargando...
          </p>
        ) : !canManage ? (
          <p className="text-sm text-muted-foreground py-4">
            No tienes permiso para gestionar los editores de este módulo. Solo
            un administrador o el coordinador del módulo puede hacerlo.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Buscar persona"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No hay personas disponibles.
                </p>
              ) : (
                filtered.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 rounded-md border p-2.5 cursor-pointer hover:bg-accent"
                  >
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggle(c.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {c.name}
                      </div>
                      {c.email && (
                        <div className="text-xs text-muted-foreground truncate">
                          {c.email}
                        </div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
        )}

        {canManage && (
          <DialogFooter>
            <Button onClick={onSave} disabled={updateMut.isPending}>
              {updateMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentacionPage() {
  const { user } = useAuth();
  const { data: status, isLoading: statusLoading } = useGetWikiStatus();
  const { data: modules = [], isLoading: modulesLoading } = useListModules({});
  const openMut = useOpenModuleWiki();

  const moduleParam = useModuleParam();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<{
    title: string;
    url: string;
    moduleId: Module["id"];
  } | null>(null);
  const [editing, setEditing] = useState<Module | null>(null);
  const [didAutoOpen, setDidAutoOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return modules;
    return modules.filter(
      (m) =>
        m.name.toLowerCase().includes(term) ||
        (m.code ?? "").toLowerCase().includes(term),
    );
  }, [modules, search]);

  const onOpen = async (module: Module) => {
    try {
      const access = await openMut.mutateAsync({ moduleId: module.id });
      const label = module.code ? `${module.code} · ${module.name}` : module.name;
      setActive({ title: label, url: access.url, moduleId: module.id });
    } catch (err) {
      const serverMessage =
        err && typeof err === "object" && "data" in err
          ? (err as { data?: { message?: unknown } }).data?.message
          : undefined;
      toast({
        title: "No se pudo abrir la documentación",
        description:
          typeof serverMessage === "string" && serverMessage.trim()
            ? serverMessage
            : "Comprueba que la documentación está configurada.",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (didAutoOpen || moduleParam == null || modules.length === 0) return;
    const match = modules.find((m) => m.id === moduleParam);
    setDidAutoOpen(true);
    if (match) void onOpen(match);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didAutoOpen, moduleParam, modules]);

  // The iframe consumes its one-time SSO ticket on load, so opening in a new
  // tab must mint a fresh ticket. Open the tab synchronously (within the click
  // gesture) to avoid popup blockers, then point it at the new URL.
  const onNewTab = async () => {
    if (!active) return;
    const win = window.open("", "_blank");
    try {
      const access = await openMut.mutateAsync({ moduleId: active.moduleId });
      if (win) win.location.href = access.url;
      else window.open(access.url, "_blank", "noreferrer");
    } catch {
      win?.close();
      toast({
        title: "No se pudo abrir en una pestaña nueva",
        description: "Vuelve a intentarlo desde la plataforma.",
        variant: "destructive",
      });
    }
  };

  const canManageEditors =
    user?.role === "superadmin" || user?.role === "coordinator";
  const notConfigured = !statusLoading && status && !status.configured;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <BookText className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Documentación</h1>
          <p className="text-sm text-muted-foreground">
            Cada módulo dispone de una wiki colaborativa. Todo el profesorado
            puede leerla; solo las personas autorizadas pueden editarla. Entra
            sin volver a iniciar sesión.
          </p>
        </div>
      </div>

      {notConfigured ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Aún no está configurada</h2>
            <p className="text-sm text-muted-foreground">
              La documentación (Outline) todavía no se ha configurado en esta
              instalación.
            </p>
            {user?.role === "superadmin" && (
              <Button asChild variant="outline">
                <Link href="/panel-control">
                  <Settings className="w-4 h-4 mr-2" /> Ir al Panel de Control
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="space-y-2 max-w-md">
              <Label htmlFor="module-search">Buscar módulo</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                <Input
                  id="module-search"
                  className="pl-8"
                  placeholder="Nombre o código del módulo"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            {modulesLoading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Cargando módulos...
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No hay módulos disponibles.
              </p>
            ) : (
              <div className="space-y-2">
                {filtered.map((module) => (
                  <div
                    key={module.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {module.code ? `${module.code} · ` : ""}
                        {module.name}
                      </div>
                      {module.cycleName && (
                        <div className="text-xs text-muted-foreground truncate">
                          {module.cycleName}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {canManageEditors && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(module)}
                        >
                          <Users className="w-4 h-4 mr-1.5" /> Editores
                        </Button>
                      )}
                      <Button
                        size="sm"
                        onClick={() => onOpen(module)}
                        disabled={openMut.isPending}
                      >
                        <BookText className="w-4 h-4 mr-1.5" /> Abrir
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {active && (
        <WikiOverlay
          title={active.title}
          url={active.url}
          onNewTab={onNewTab}
          onClose={() => setActive(null)}
        />
      )}

      {editing && (
        <EditorsDialog
          module={editing}
          open={editing != null}
          onOpenChange={(o) => {
            if (!o) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
