import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListResources,
  useListModules,
  useCreateResource,
  useDeleteResource,
  getListResourcesQueryKey,
  type ListResourcesParams,
  type CreateResourceInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useModuleParam } from "@/lib/use-module-param";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  FolderOpen,
  Plus,
  Search,
  Download,
  Trash2,
  FileText,
  User as UserIcon,
} from "lucide-react";

const ALL = "all";
const NONE = "none";

const RESOURCE_TYPES = [
  "Programación didáctica",
  "Material de aula",
  "Examen / prueba",
  "Documento",
  "Enlace",
];

function CreateResourceDialog() {
  const qc = useQueryClient();
  const { data: modules = [] } = useListModules({});
  const createMut = useCreateResource();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState(RESOURCE_TYPES[0]);
  const [description, setDescription] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setType(RESOURCE_TYPES[0]);
      setDescription("");
      setFileUrl("");
      setModuleId(null);
      setError(null);
    }
  }, [open]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("El título es obligatorio.");
      return;
    }
    const payload: CreateResourceInput = {
      title: title.trim(),
      type,
      description: description.trim() || null,
      fileUrl: fileUrl.trim() || null,
      moduleId,
    };
    try {
      await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListResourcesQueryKey() });
      toast({ title: "Recurso publicado", description: title.trim() });
      setOpen(false);
    } catch {
      setError("No se pudo publicar el recurso. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Subir recurso
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subir recurso</DialogTitle>
          <DialogDescription>
            Comparte programaciones y material con el profesorado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="r-title">Título *</Label>
            <Input
              id="r-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-desc">Descripción</Label>
            <Textarea
              id="r-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="r-url">Enlace al archivo</Label>
            <Input
              id="r-url"
              value={fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label>Módulo</Label>
            <Select
              value={moduleId != null ? String(moduleId) : NONE}
              onValueChange={(v) => setModuleId(v === NONE ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin módulo</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.code ? `${m.code} · ` : ""}
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Publicando..." : "Publicar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RecursosPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const deleteMut = useDeleteResource();

  const moduleParam = useModuleParam();
  const [search, setSearch] = useState("");
  const [moduleId, setModuleId] = useState<number | null>(moduleParam);

  const { data: modules = [] } = useListModules({});

  const params: ListResourcesParams = {};
  if (search.trim()) params.search = search.trim();
  if (moduleId != null) params.moduleId = moduleId;

  const { data: resources = [], isLoading } = useListResources(params);

  const canDelete = (authorId: number | null | undefined) =>
    authorId === user?.id ||
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head";

  const onDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListResourcesQueryKey() });
      toast({ title: "Recurso eliminado" });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <FolderOpen className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Repositorio de recursos
          </h1>
          <p className="text-sm text-muted-foreground">
            Programaciones y material compartido por el profesorado.
          </p>
        </div>
        <CreateResourceDialog />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título o descripción..."
            className="pl-9"
          />
        </div>
        <Select
          value={moduleId != null ? String(moduleId) : ALL}
          onValueChange={(v) => setModuleId(v === ALL ? null : Number(v))}
        >
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue placeholder="Todos los módulos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los módulos</SelectItem>
            {modules.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.code ? `${m.code} · ` : ""}
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : resources.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay recursos. Sé el primero en compartir material.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r) => {
            const moduleName = modules.find((m) => m.id === r.moduleId)?.name;
            const author = r.authorName ?? r.originalAuthorName;
            return (
              <Card key={r.id} className="flex flex-col">
                <CardContent className="p-4 flex flex-col gap-3 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {r.type}
                    </Badge>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold leading-tight">{r.title}</h3>
                    {r.description && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                        {r.description}
                      </p>
                    )}
                  </div>
                  {moduleName && (
                    <Badge variant="outline" className="w-fit">
                      {moduleName}
                    </Badge>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <UserIcon className="w-3 h-3" />
                    {author ? (
                      <span>
                        {author}
                        {r.authorName == null &&
                          r.originalAuthorName != null && (
                            <span className="italic"> (autor original)</span>
                          )}
                      </span>
                    ) : (
                      <span>Autor desconocido</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    {r.fileUrl ? (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="gap-2 flex-1"
                      >
                        <a
                          href={r.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Download className="w-4 h-4" /> Abrir
                        </a>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground flex-1">
                        Sin archivo adjunto
                      </span>
                    )}
                    {canDelete(r.authorId) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              ¿Eliminar recurso?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Se eliminará «{r.title}». Esta acción no se puede
                              deshacer.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDelete(r.id)}>
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
