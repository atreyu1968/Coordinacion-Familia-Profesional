import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListForumModules,
  useListForumThreads,
  useCreateForumThread,
  useDeleteForumThread,
  useListForumPosts,
  useCreateForumPost,
  useDeleteForumPost,
  getListForumModulesQueryKey,
  getListForumThreadsQueryKey,
  getListForumPostsQueryKey,
  type ForumModule,
  type ForumThread,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  MessagesSquare,
  Plus,
  ChevronLeft,
  MessageSquare,
  Trash2,
  User as UserIcon,
  Send,
} from "lucide-react";

const SIN_CICLO = "Sin ciclo";

function formatDate(value: string): string {
  const d = new Date(value);
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Mirrors the backend delete rules: the author may always delete; a superadmin
// may delete anything; province/center managers may delete only scoped
// (non-global) content they can see (their visibility already guarantees the
// content is within their scope). Global threads (centerId == null) are
// author/superadmin-only, matching the server's hasScopeOver check.
function useCanManage() {
  const { user } = useAuth();
  return (
    authorId: number | null | undefined,
    centerId: number | null | undefined,
  ) => {
    if (authorId != null && authorId === user?.id) return true;
    if (user?.role === "superadmin") return true;
    if (
      (user?.role === "coordinator" || user?.role === "department_head") &&
      centerId != null
    ) {
      return true;
    }
    return false;
  };
}

// ---------------------------------------------------------------------------
// New thread dialog
// ---------------------------------------------------------------------------
function NewThreadDialog({ module }: { module: ForumModule }) {
  const qc = useQueryClient();
  const createMut = useCreateForumThread();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !content.trim()) {
      setError("El título y el mensaje son obligatorios.");
      return;
    }
    try {
      await createMut.mutateAsync({
        data: {
          moduleId: module.id,
          title: title.trim(),
          content: content.trim(),
        },
      });
      await qc.invalidateQueries({
        queryKey: getListForumThreadsQueryKey({ moduleId: module.id }),
      });
      await qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() });
      toast({ title: "Tema creado", description: title.trim() });
      setTitle("");
      setContent("");
      setOpen(false);
    } catch {
      setError("No se pudo crear el tema. Inténtalo de nuevo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="w-4 h-4" /> Nuevo tema
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo tema</DialogTitle>
          <DialogDescription>
            Abre un debate en el foro de {module.name}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="t-title">Título *</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-content">Mensaje *</Label>
            <Textarea
              id="t-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
            />
          </div>
          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Creando..." : "Crear tema"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Thread detail (posts list + reply box)
// ---------------------------------------------------------------------------
function ThreadDetail({
  thread,
  onBack,
}: {
  thread: ForumThread;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const canManage = useCanManage();
  const { data: posts = [], isLoading } = useListForumPosts(thread.id);
  const createMut = useCreateForumPost();
  const deletePostMut = useDeleteForumPost();
  const [reply, setReply] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: getListForumPostsQueryKey(thread.id),
    });
    await qc.invalidateQueries({
      queryKey: getListForumThreadsQueryKey({ moduleId: thread.moduleId }),
    });
  };

  const onReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    try {
      await createMut.mutateAsync({
        id: thread.id,
        data: { content: reply.trim() },
      });
      setReply("");
      await refresh();
    } catch {
      toast({
        title: "No se pudo enviar",
        description: "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const onDeletePost = async (id: number) => {
    try {
      await deletePostMut.mutateAsync({ id });
      await refresh();
      toast({ title: "Mensaje eliminado" });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
        <ChevronLeft className="w-4 h-4" /> Volver a los temas
      </Button>
      <div>
        <h2 className="text-xl font-bold tracking-tight">{thread.title}</h2>
        <p className="text-sm text-muted-foreground">
          {thread.moduleName}
          {thread.authorName ? ` · ${thread.authorName}` : ""}
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    {p.authorName ?? "Usuario"}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(p.createdAt)}
                    </span>
                    {canManage(p.authorId, thread.centerId) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              ¿Eliminar mensaje?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Esta acción no se puede deshacer.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDeletePost(p.id)}>
                              Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{p.content}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <form onSubmit={onReply} className="flex gap-2 pt-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Escribe una respuesta..."
          rows={2}
          className="flex-1"
        />
        <Button
          type="submit"
          className="gap-2 self-end"
          disabled={createMut.isPending || !reply.trim()}
        >
          <Send className="w-4 h-4" /> Enviar
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread list for a module
// ---------------------------------------------------------------------------
function ModuleThreads({
  module,
  onBack,
}: {
  module: ForumModule;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const canManage = useCanManage();
  const { data: threads = [], isLoading } = useListForumThreads({
    moduleId: module.id,
  });
  const deleteThreadMut = useDeleteForumThread();
  const [active, setActive] = useState<ForumThread | null>(null);

  const onDeleteThread = async (id: number) => {
    try {
      await deleteThreadMut.mutateAsync({ id });
      await qc.invalidateQueries({
        queryKey: getListForumThreadsQueryKey({ moduleId: module.id }),
      });
      await qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() });
      toast({ title: "Tema eliminado" });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  if (active) {
    return <ThreadDetail thread={active} onBack={() => setActive(null)} />;
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
        <ChevronLeft className="w-4 h-4" /> Volver a los módulos
      </Button>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h2 className="text-xl font-bold tracking-tight">{module.name}</h2>
          {module.cycleName && (
            <p className="text-sm text-muted-foreground">{module.cycleName}</p>
          )}
        </div>
        <NewThreadDialog module={module} />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : threads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Aún no hay temas en este foro. ¡Crea el primero!
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Card
              key={t.id}
              className="hover:bg-accent/50 transition-colors cursor-pointer"
            >
              <CardContent className="p-4 flex items-center gap-3">
                <button
                  type="button"
                  className="flex-1 text-left"
                  onClick={() => setActive(t)}
                >
                  <h3 className="font-semibold leading-tight">{t.title}</h3>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <UserIcon className="w-3 h-3" />
                      {t.authorName ?? "Usuario"}
                    </span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" />
                      {t.postCount}
                    </span>
                    <span>{formatDate(t.lastPostAt)}</span>
                  </div>
                </button>
                {canManage(t.authorId, t.centerId) && (
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
                        <AlertDialogTitle>¿Eliminar tema?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Se eliminará «{t.title}» y sus mensajes. Esta acción no
                          se puede deshacer.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDeleteThread(t.id)}>
                          Eliminar
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Landing: modules grouped by cycle
// ---------------------------------------------------------------------------
export default function ForosPage() {
  const { data: modules = [], isLoading } = useListForumModules();
  const [active, setActive] = useState<ForumModule | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, ForumModule[]>();
    for (const m of modules) {
      const key = m.cycleName ?? SIN_CICLO;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [modules]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <MessagesSquare className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            Foros por módulos
          </h1>
          <p className="text-sm text-muted-foreground">
            Debates organizados por ciclo formativo y módulo.
          </p>
        </div>
      </div>

      {active ? (
        <ModuleThreads module={active} onBack={() => setActive(null)} />
      ) : isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : modules.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No hay módulos disponibles para tu ámbito.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(([cycle, mods]) => (
            <div key={cycle} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {cycle}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mods.map((m) => (
                  <Card
                    key={m.id}
                    className="hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => setActive(m)}
                  >
                    <CardContent className="p-4 flex items-start gap-3">
                      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                        <MessagesSquare className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold leading-tight">
                          {m.name}
                        </h3>
                        {m.code && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {m.code}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="shrink-0">
                        {m.threadCount}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
