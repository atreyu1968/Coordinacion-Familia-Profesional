import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListForumModules,
  useListForumThreads,
  useCreateForumThread,
  useDeleteForumThread,
  useUpdateForumThread,
  usePinForumThread,
  useMarkForumThreadRead,
  useListForumPosts,
  useCreateForumPost,
  useDeleteForumPost,
  useUpdateForumPost,
  getListForumModulesQueryKey,
  getListForumThreadsQueryKey,
  getListForumPostsQueryKey,
  type ForumModule,
  type ForumThread,
  type ForumPost,
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
  Pencil,
  Pin,
  PinOff,
  Search,
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

// Pin/unpin is a moderation action: managers only (no author shortcut), and
// only over scoped content, mirroring the backend hasScopeOver check.
function useCanModerate() {
  const { user } = useAuth();
  return (centerId: number | null | undefined) => {
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

function useIsAuthor() {
  const { user } = useAuth();
  return (authorId: number | null | undefined) =>
    authorId != null && authorId === user?.id;
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
// Edit thread title dialog (author only)
// ---------------------------------------------------------------------------
function EditThreadDialog({
  thread,
  onDone,
}: {
  thread: ForumThread;
  onDone: () => void;
}) {
  const updateMut = useUpdateForumThread();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(thread.title);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await updateMut.mutateAsync({ id: thread.id, data: { title: title.trim() } });
      toast({ title: "Tema actualizado" });
      setOpen(false);
      onDone();
    } catch {
      toast({
        title: "No se pudo editar",
        description: "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setTitle(thread.title); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar tema</DialogTitle>
          <DialogDescription>Cambia el título del tema.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="e-title">Título *</Label>
            <Input
              id="e-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={updateMut.isPending || !title.trim()}>
              {updateMut.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Single post with inline edit (author only) + delete
// ---------------------------------------------------------------------------
function PostCard({
  post,
  centerId,
  onChanged,
}: {
  post: ForumPost;
  centerId: number | null | undefined;
  onChanged: () => void;
}) {
  const canManage = useCanManage();
  const isAuthor = useIsAuthor();
  const updateMut = useUpdateForumPost();
  const deleteMut = useDeleteForumPost();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.content);

  const onSaveEdit = async () => {
    if (!draft.trim()) return;
    try {
      await updateMut.mutateAsync({ id: post.id, data: { content: draft.trim() } });
      setEditing(false);
      onChanged();
      toast({ title: "Mensaje actualizado" });
    } catch {
      toast({
        title: "No se pudo editar",
        description: "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const onDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: post.id });
      onChanged();
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
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <UserIcon className="w-3.5 h-3.5 text-muted-foreground" />
            {post.authorName ?? "Usuario"}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatDate(post.createdAt)}
              {post.editedAt ? " · editado" : ""}
            </span>
            {isAuthor(post.authorId) && !editing && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => {
                  setDraft(post.content);
                  setEditing(true);
                }}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            )}
            {canManage(post.authorId, centerId) && (
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
                    <AlertDialogTitle>¿Eliminar mensaje?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acción no se puede deshacer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>
                      Eliminar
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
            />
            <div className="flex gap-2 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={onSaveEdit}
                disabled={updateMut.isPending || !draft.trim()}
              >
                Guardar
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap">{post.content}</p>
        )}
      </CardContent>
    </Card>
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
  const { data: posts = [], isLoading } = useListForumPosts(thread.id);
  const createMut = useCreateForumPost();
  const markReadMut = useMarkForumThreadRead();
  const [reply, setReply] = useState("");

  // Mark the thread read on open, then refresh the unread badges.
  useEffect(() => {
    markReadMut.mutate(
      { id: thread.id },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() });
          void qc.invalidateQueries({
            queryKey: getListForumThreadsQueryKey({ moduleId: thread.moduleId }),
          });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id]);

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
      // Replying counts as reading the thread.
      markReadMut.mutate({ id: thread.id });
    } catch {
      toast({
        title: "No se pudo enviar",
        description: "Inténtalo de nuevo.",
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
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
          {thread.pinnedAt && <Pin className="w-4 h-4 text-primary" />}
          {thread.title}
        </h2>
        <p className="text-sm text-muted-foreground">
          {thread.moduleName}
          {thread.authorName ? ` · ${thread.authorName}` : ""}
          {thread.editedAt ? " · editado" : ""}
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => (
            <PostCard
              key={p.id}
              post={p}
              centerId={thread.centerId}
              onChanged={refresh}
            />
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
  const canModerate = useCanModerate();
  const isAuthor = useIsAuthor();
  const [search, setSearch] = useState("");
  const { data: threads = [], isLoading } = useListForumThreads({
    moduleId: module.id,
    ...(search.trim() ? { q: search.trim() } : {}),
  });
  const deleteThreadMut = useDeleteForumThread();
  const pinMut = usePinForumThread();
  const [active, setActive] = useState<ForumThread | null>(null);

  const invalidate = async () => {
    await qc.invalidateQueries({
      queryKey: getListForumThreadsQueryKey({ moduleId: module.id }),
    });
    await qc.invalidateQueries({ queryKey: getListForumModulesQueryKey() });
  };

  const onDeleteThread = async (id: number) => {
    try {
      await deleteThreadMut.mutateAsync({ id });
      await invalidate();
      toast({ title: "Tema eliminado" });
    } catch {
      toast({
        title: "No se pudo eliminar",
        description: "Comprueba tus permisos.",
        variant: "destructive",
      });
    }
  };

  const onTogglePin = async (t: ForumThread) => {
    try {
      await pinMut.mutateAsync({ id: t.id, data: { pinned: !t.pinnedAt } });
      await invalidate();
      toast({ title: t.pinnedAt ? "Tema desfijado" : "Tema fijado" });
    } catch {
      toast({
        title: "No se pudo cambiar",
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

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar temas por título..."
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="text-muted-foreground py-8 text-center">Cargando...</p>
      ) : threads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {search.trim()
              ? "Ningún tema coincide con tu búsqueda."
              : "Aún no hay temas en este foro. ¡Crea el primero!"}
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
                  <h3 className="font-semibold leading-tight flex items-center gap-1.5">
                    {t.pinnedAt && (
                      <Pin className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                    {t.title}
                    {t.unreadCount > 0 && (
                      <Badge className="ml-1 h-5 px-1.5">{t.unreadCount}</Badge>
                    )}
                  </h3>
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
                {isAuthor(t.authorId) && (
                  <EditThreadDialog thread={t} onDone={invalidate} />
                )}
                {canModerate(t.centerId) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    title={t.pinnedAt ? "Desfijar" : "Fijar"}
                    onClick={() => onTogglePin(t)}
                  >
                    {t.pinnedAt ? (
                      <PinOff className="w-4 h-4" />
                    ) : (
                      <Pin className="w-4 h-4" />
                    )}
                  </Button>
                )}
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
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.code ?? "").toLowerCase().includes(q) ||
        (m.cycleName ?? "").toLowerCase().includes(q),
    );
  }, [modules, search]);

  const groups = useMemo(() => {
    const map = new Map<string, ForumModule[]>();
    for (const m of filtered) {
      const key = m.cycleName ?? SIN_CICLO;
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar módulo o ciclo..."
              className="pl-9"
            />
          </div>

          {groups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Ningún módulo coincide con tu búsqueda.
              </CardContent>
            </Card>
          ) : (
            groups.map(([cycle, mods]) => (
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
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <Badge variant="secondary">{m.threadCount}</Badge>
                          {m.unreadCount > 0 && (
                            <Badge>{m.unreadCount} nuevos</Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
