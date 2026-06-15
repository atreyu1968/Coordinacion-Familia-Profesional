import { useEffect, useMemo, useState } from "react";
import {
  useListModules,
  useGetCollabStatus,
  useOpenModuleSpace,
  type Module,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useModuleParam } from "@/lib/use-module-param";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  FolderKanban,
  ExternalLink,
  X,
  Settings,
  Search,
} from "lucide-react";
import { Link } from "wouter";

// ---------------------------------------------------------------------------
// Fullscreen Nextcloud/Collabora space overlay (same pattern as the
// videoconference call overlay).
// ---------------------------------------------------------------------------
function SpaceOverlay({
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
          <FolderKanban className="w-4 h-4" />
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
            aria-label="Cerrar el espacio colaborativo"
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

export default function EspacioColaborativoPage() {
  const { user } = useAuth();
  const { data: status, isLoading: statusLoading } = useGetCollabStatus();
  const { data: modules = [], isLoading: modulesLoading } = useListModules();
  const openMut = useOpenModuleSpace();

  const moduleParam = useModuleParam();
  const [search, setSearch] = useState("");
  const [active, setActive] = useState<{
    title: string;
    url: string;
    moduleId: Module["id"];
  } | null>(null);
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
      // Surface the server's specific message (e.g. "Espacio colaborativo no
      // configurado", "No se pudo preparar el espacio colaborativo") instead of a
      // generic one, so the cause (config vs. provisioning vs. access) is visible.
      const serverMessage =
        err && typeof err === "object" && "data" in err
          ? (err as { data?: { message?: unknown } }).data?.message
          : undefined;
      toast({
        title: "No se pudo abrir el espacio",
        description:
          typeof serverMessage === "string" && serverMessage.trim()
            ? serverMessage
            : "Comprueba que tienes acceso al módulo y que el espacio colaborativo está configurado.",
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

  // The iframe consumes its one-time SSO ticket on load, so the original URL is
  // already spent. Opening it in a new tab must mint a *fresh* ticket. Open the
  // tab synchronously (within the click gesture) to avoid popup blockers, then
  // point it at the new URL once the request resolves.
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
        description:
          "Vuelve a intentarlo. Si persiste, abre el espacio desde la plataforma.",
        variant: "destructive",
      });
    }
  };

  const notConfigured = !statusLoading && status && !status.configured;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Espacio colaborativo
        </h1>
        <p className="text-muted-foreground">
          Cada módulo dispone de una carpeta compartida (Nextcloud) y un editor
          de documentos en tiempo real (Collabora). Entra sin volver a iniciar
          sesión.
        </p>
      </div>

      {notConfigured ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">Aún no está configurado</h2>
            <p className="text-sm text-muted-foreground">
              El espacio colaborativo (Nextcloud + Collabora) todavía no se ha
              configurado en esta instalación.
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
                    <Button
                      size="sm"
                      onClick={() => onOpen(module)}
                      disabled={openMut.isPending}
                    >
                      <FolderKanban className="w-4 h-4 mr-1.5" /> Abrir espacio
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {active && (
        <SpaceOverlay
          title={active.title}
          url={active.url}
          onNewTab={onNewTab}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}
