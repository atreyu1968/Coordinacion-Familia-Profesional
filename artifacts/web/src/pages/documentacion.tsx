import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  getGetWikiPageQueryKey,
  getListWikiPagesQueryKey,
  useAddWikiAttachment,
  useAddWikiExternalLink,
  useCreateWikiPage,
  useDeleteWikiAttachment,
  useDeleteWikiExternalLink,
  useDeleteWikiPage,
  useGetWikiPage,
  useListModules,
  useListWikiPages,
  useRequestWikiUploadUrl,
  useUpdateWikiPage,
  type Module,
  type WikiPage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { useAuth } from "@/lib/auth";
import { useModuleParam } from "@/lib/use-module-param";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "@/hooks/use-toast";
import { WikiPermissionEditorDialog } from "@/components/WikiPermissionEditorDialog";
import {
  BookText,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Link2,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
} from "lucide-react";

const TOKEN_KEY = "coordina_adg_token";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const WIKI_ATTACHMENT_ACCEPT = [
  ".zip", "application/zip", "application/x-zip-compressed",
  ".rar", "application/vnd.rar", "application/x-rar-compressed",
  ".pdf", "application/pdf",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  // Microsoft Word
  ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".docb",
  // Microsoft Excel
  ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".xla", ".xlam", ".xlw",
  // Microsoft PowerPoint
  ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".ppa", ".ppam",
  // Other common Microsoft formats
  ".vsd", ".vsdx", ".vsdm", ".vss", ".vssx", ".vssm", ".vst", ".vstx", ".vstm",
  ".one", ".onepkg", ".onetoc2", ".pub", ".accdb", ".accde", ".mdb", ".mde",
  ".mpp", ".mpt", ".msg", ".pst", ".ost", ".xps",
  ".odt", ".ods", ".odp", ".txt", ".md", ".csv", ".tsv", ".json", ".xml",
  ".html", ".htm", ".yml", ".yaml", ".log",
].join(",");

function isAllowedExternalFileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function externalLinkHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function moduleLabel(module: Module | undefined): string {
  if (!module) return "Documentación general";
  return module.code ? `${module.code} · ${module.name}` : module.name;
}

function inlineText(line: string) {
  const chunks = line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return chunks.map((chunk, index) => {
    if (chunk.startsWith("**") && chunk.endsWith("**")) {
      return <strong key={index}>{chunk.slice(2, -2)}</strong>;
    }
    if (chunk.startsWith("`") && chunk.endsWith("`")) {
      return (
        <code key={index} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">
          {chunk.slice(1, -1)}
        </code>
      );
    }
    return <span key={index}>{chunk}</span>;
  });
}

function PageContent({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm italic text-muted-foreground">Esta página aún no tiene contenido.</p>;
  }

  return (
    <div className="space-y-3 break-words text-sm leading-7">
      {content.split(/\r?\n/).map((line, index) => {
        if (!line.trim()) return <div key={index} className="h-1" />;
        if (line.startsWith("### ")) {
          return <h3 key={index} className="pt-2 text-base font-semibold">{inlineText(line.slice(4))}</h3>;
        }
        if (line.startsWith("## ")) {
          return <h2 key={index} className="pt-3 text-lg font-semibold">{inlineText(line.slice(3))}</h2>;
        }
        if (line.startsWith("# ")) {
          return <h2 key={index} className="pt-3 text-xl font-bold">{inlineText(line.slice(2))}</h2>;
        }
        if (/^\s*[-*]\s+/.test(line)) {
          return (
            <div key={index} className="flex gap-2 pl-2">
              <span aria-hidden="true">•</span>
              <span>{inlineText(line.replace(/^\s*[-*]\s+/, ""))}</span>
            </div>
          );
        }
        if (line.startsWith("> ")) {
          return (
            <blockquote key={index} className="border-l-2 pl-4 text-muted-foreground">
              {inlineText(line.slice(2))}
            </blockquote>
          );
        }
        return <p key={index}>{inlineText(line)}</p>;
      })}
    </div>
  );
}

function attachmentStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Pendiente de indexación";
    case "processing":
      return "Indexando";
    case "indexed":
      return "Texto indexado";
    case "skipped":
      return "Búsqueda por nombre";
    default:
      return "No se pudo indexar el contenido";
  }
}

function EditorsDialog({
  module,
  open,
  onOpenChange,
}: {
  module: Module;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <WikiPermissionEditorDialog
      moduleId={module.id}
      sectionName={moduleLabel(module)}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}

function PageEditorDialog({
  open,
  onOpenChange,
  sectionName,
  moduleId,
  page,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionName: string;
  moduleId: number | null;
  page: WikiPage | null;
  onSaved: (pageId: number) => void;
}) {
  const queryClient = useQueryClient();
  const createMutation = useCreateWikiPage();
  const updateMutation = useUpdateWikiPage();
  const form = useForm<{ title: string; content: string; tags: string }>({
    defaultValues: {
      title: "",
      content: "",
      tags: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      title: page?.title ?? "",
      content: page?.content ?? "",
      tags: page?.tags.join(", ") ?? "",
    });
  }, [form, open, page?.id]);

  const save = form.handleSubmit(async (values) => {
    const tags = values.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      if (page) {
        const updated = await updateMutation.mutateAsync({
          pageId: page.id,
          data: { title: values.title.trim(), content: values.content, tags },
        });
        await queryClient.invalidateQueries({
          queryKey: getGetWikiPageQueryKey(page.id),
        });
        await queryClient.invalidateQueries({ queryKey: getListWikiPagesQueryKey() });
        toast({ title: "Página actualizada" });
        onSaved(updated.id);
      } else {
        const created = await createMutation.mutateAsync({
          data: {
            moduleId,
            parentId: null,
            title: values.title.trim(),
            content: values.content,
            tags,
          },
        });
        await queryClient.invalidateQueries({ queryKey: getListWikiPagesQueryKey() });
        toast({ title: "Página creada" });
        onSaved(created.id);
      }
      onOpenChange(false);
    } catch {
      toast({
        title: page ? "No se pudo actualizar la página" : "No se pudo crear la página",
        description: "Comprueba tu conexión y tus permisos.",
        variant: "destructive",
      });
    }
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{page ? "Editar página" : "Nueva página"}</DialogTitle>
          <DialogDescription>
            Se guardará en «{sectionName}». El contenido es privado y solo se muestra a usuarios autenticados.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={save} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              rules={{ required: "Escribe un título", maxLength: 200 }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input data-testid="input-wiki-title" autoFocus maxLength={200} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contenido</FormLabel>
                  <FormControl>
                    <Textarea
                      data-testid="textarea-wiki-content"
                      className="min-h-64 resize-y font-mono text-sm"
                      placeholder={"# Encabezado\n\nEscribe aquí la documentación. Puedes usar **negrita**, `código`, listas con - y citas con >."}
                      maxLength={100000}
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Admite encabezados (#), listas con guion, citas, negrita y código.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Etiquetas</FormLabel>
                  <FormControl>
                    <Input
                      data-testid="input-wiki-tags"
                      placeholder="Procedimientos, evaluación, curso"
                      {...field}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Separa las etiquetas con comas.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                data-testid="button-cancel-wiki-page"
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button data-testid="button-submit-wiki-page" type="submit" disabled={isPending}>
                {isPending ? "Guardando..." : page ? "Guardar cambios" : "Crear página"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function DocumentacionPage() {
  const { user } = useAuth();
  const moduleParam = useModuleParam();
  const { data: modules = [], isLoading: modulesLoading } = useListModules({});
  const queryClient = useQueryClient();
  const [scope, setScope] = useState(() =>
    moduleParam ? String(moduleParam) : "all",
  );
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [kind, setKind] = useState<"all" | "files" | "zip">("all");
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPage, setEditorPage] = useState<WikiPage | null>(null);
  const [editorsModule, setEditorsModule] = useState<Module | null>(null);
  const [uploading, setUploading] = useState(false);
  const [externalLinkDialogOpen, setExternalLinkDialogOpen] = useState(false);
  const [externalLinkTitle, setExternalLinkTitle] = useState("");
  const [externalLinkUrl, setExternalLinkUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (moduleParam != null) setScope(String(moduleParam));
  }, [moduleParam]);

  const selectedModuleId = /^\d+$/.test(scope) ? Number(scope) : null;
  const selectedModule = modules.find((module) => module.id === selectedModuleId);
  const isGeneralScope = scope === "general";
  const pageQuery = useMemo(
    () => ({
      ...(selectedModuleId !== null ? { moduleId: selectedModuleId } : {}),
      ...(isGeneralScope ? { globalOnly: true } : {}),
      ...(search.trim() ? { q: search.trim() } : {}),
      ...(tagFilter.trim() ? { tag: tagFilter.trim() } : {}),
      ...(kind !== "all" ? { kind } : {}),
    }),
    [isGeneralScope, kind, search, selectedModuleId, tagFilter],
  );
  const pagesQuery = useListWikiPages(pageQuery, {
    query: {
      enabled: !!user,
      queryKey: getListWikiPagesQueryKey(pageQuery),
      staleTime: 15_000,
    },
  });
  const pages = pagesQuery.data?.items ?? [];
  const selectedId = selectedPageId ?? pages[0]?.id ?? null;
  const pageQueryResult = useGetWikiPage(selectedId ?? 0, {
    query: {
      enabled: !!user && selectedId !== null,
      queryKey: getGetWikiPageQueryKey(selectedId ?? 0),
      staleTime: 15_000,
    },
  });
  const page = pageQueryResult.data;

  const requestUploadMutation = useRequestWikiUploadUrl();
  const addAttachmentMutation = useAddWikiAttachment();
  const deleteAttachmentMutation = useDeleteWikiAttachment();
  const addExternalLinkMutation = useAddWikiExternalLink();
  const deleteExternalLinkMutation = useDeleteWikiExternalLink();
  const deletePageMutation = useDeleteWikiPage();

  useEffect(() => {
    if (selectedPageId === null && pages.length > 0) {
      setSelectedPageId(pages[0].id);
    }
  }, [pages, selectedPageId]);

  const sectionName =
    selectedModuleId !== null
      ? moduleLabel(selectedModule)
      : isGeneralScope
        ? "Documentación general"
        : "Todas las secciones";

  const invalidateWiki = async (pageId?: number) => {
    await queryClient.invalidateQueries({ queryKey: getListWikiPagesQueryKey() });
    if (pageId) {
      await queryClient.invalidateQueries({
        queryKey: getGetWikiPageQueryKey(pageId),
      });
    }
  };

  const downloadAttachment = async (attachmentId: number, fileName: string) => {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}api/wiki/attachments/${attachmentId}/download`,
        { headers: authHeaders() },
      );
      if (!response.ok) throw new Error("No se pudo descargar el archivo");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      toast({
        title: "No se pudo descargar el archivo",
        description: "Comprueba tu sesión e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || !page) return;
    setUploading(true);
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
          toast({
            title: `No se pudo subir ${file.name}`,
            description: "El tamaño debe estar entre 1 byte y 50 MB.",
            variant: "destructive",
          });
          continue;
        }
        const contentType = file.type || "application/octet-stream";
        const upload = await requestUploadMutation.mutateAsync({
          data: { pageId: page.id, fileName: file.name, size: file.size, contentType },
        });
        const uploadResponse = await fetch(upload.uploadURL, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Falló la transferencia de ${file.name}`);
        }
        await addAttachmentMutation.mutateAsync({
          pageId: page.id,
          data: {
            fileName: file.name,
            objectPath: upload.objectPath,
            contentType,
            size: file.size,
          },
        });
        uploaded += 1;
      }
      await invalidateWiki(page.id);
      if (uploaded > 0) {
        toast({
          title: uploaded === 1 ? "Archivo añadido" : `${uploaded} archivos añadidos`,
          description: "El indexado de texto continúa en segundo plano.",
        });
      }
    } catch (error) {
      toast({
        title: "No se completó la subida",
        description:
          error instanceof Error
            ? error.message
            : "Comprueba la conexión e inténtalo de nuevo.",
        variant: "destructive",
      });
      await invalidateWiki(page.id);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAttachment = async (attachmentId: number) => {
    if (!page || !window.confirm("¿Retirar este archivo de la página?")) return;
    try {
      await deleteAttachmentMutation.mutateAsync({ attachmentId });
      await invalidateWiki(page.id);
      toast({ title: "Archivo retirado" });
    } catch {
      toast({
        title: "No se pudo retirar el archivo",
        variant: "destructive",
      });
    }
  };

  const addExternalLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!page) return;
    const title = externalLinkTitle.trim();
    const url = externalLinkUrl.trim();
    if (!title || title.length > 240 || !isAllowedExternalFileUrl(url)) {
      toast({
        title: "Revisa los datos del enlace",
        description: "Usa un nombre y una dirección HTTP o HTTPS válida.",
        variant: "destructive",
      });
      return;
    }
    try {
      await addExternalLinkMutation.mutateAsync({
        pageId: page.id,
        data: { title, url },
      });
      setExternalLinkDialogOpen(false);
      setExternalLinkTitle("");
      setExternalLinkUrl("");
      await invalidateWiki(page.id);
      toast({ title: "Enlace añadido" });
    } catch {
      toast({
        title: "No se pudo añadir el enlace",
        description: "Comprueba tu conexión e inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const removeExternalLink = async (externalLinkId: number, title: string) => {
    if (!page || !window.confirm(`¿Retirar el enlace «${title}»?`)) return;
    try {
      await deleteExternalLinkMutation.mutateAsync({ externalLinkId });
      await invalidateWiki(page.id);
      toast({ title: "Enlace retirado" });
    } catch {
      toast({
        title: "No se pudo retirar el enlace",
        variant: "destructive",
      });
    }
  };

  const removePage = async () => {
    if (!page || !window.confirm(`¿Eliminar la página «${page.title}»?`)) return;
    try {
      await deletePageMutation.mutateAsync({ pageId: page.id });
      setSelectedPageId(null);
      await invalidateWiki();
      toast({ title: "Página eliminada" });
    } catch {
      toast({
        title: "No se pudo eliminar la página",
        variant: "destructive",
      });
    }
  };

  const handlePageSaved = async (pageId: number) => {
    setSelectedPageId(pageId);
    await invalidateWiki(pageId);
  };

  const canCreate = pagesQuery.data?.canCreate ?? false;
  const scopeOptions = [
    { value: "all", label: "Todas las secciones" },
    { value: "general", label: "Documentación general" },
    ...modules.map((module) => ({
      value: String(module.id),
      label: moduleLabel(module),
    })),
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <BookText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Documentación</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Wiki interna con páginas por módulo, archivos privados, enlaces externos, búsqueda de texto y filtros.
          </p>
        </div>
        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
          Solo usuarios autenticados
        </Badge>
      </header>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_minmax(210px,1fr)_minmax(150px,.7fr)_minmax(150px,.7fr)_auto]">
            <div className="space-y-1.5">
              <Label htmlFor="wiki-search">Buscar en la wiki</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  data-testid="input-wiki-search"
                  id="wiki-search"
                  className="pl-8"
                  placeholder="Título, contenido o archivo"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wiki-scope">Sección</Label>
              <select
                data-testid="select-wiki-scope"
                id="wiki-scope"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  setSelectedPageId(null);
                }}
              >
                {scopeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wiki-tag-filter">Etiqueta</Label>
              <Input
                data-testid="input-wiki-tag-filter"
                id="wiki-tag-filter"
                placeholder="Filtrar etiqueta"
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wiki-kind-filter">Tipo</Label>
              <select
                data-testid="select-wiki-kind"
                id="wiki-kind-filter"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                <option value="all">Todo</option>
                <option value="files">Con archivos</option>
                <option value="zip">Con ZIP/RAR</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              {selectedModule && (user?.role === "superadmin" || user?.role === "coordinator") && (
                <Button
                  data-testid="button-manage-wiki-editors"
                  variant="outline"
                  onClick={() => setEditorsModule(selectedModule)}
                  aria-label="Gestionar editores del módulo"
                >
                  <Users className="h-4 w-4" />
                </Button>
              )}
              {canCreate && (
                <Button
                  data-testid="button-create-wiki-page"
                  className="w-full md:w-auto"
                  onClick={() => {
                    setEditorPage(null);
                    setEditorOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Nueva página
                </Button>
              )}
            </div>
          </div>
          {scope === "all" && (
            <p className="text-xs text-muted-foreground">
              Para crear una página, selecciona «Documentación general» o un módulo.
            </p>
          )}
        </CardContent>
      </Card>

      {modulesLoading ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Cargando secciones...</CardContent></Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <Card className="min-h-[420px]">
            <CardContent className="p-0">
              <div className="border-b px-4 py-3">
                <div className="font-semibold">Páginas</div>
                <div className="text-xs text-muted-foreground">
                  {pages.length} resultado{pages.length === 1 ? "" : "s"}
                </div>
              </div>
              <div className="max-h-[70vh] overflow-y-auto p-2">
                {pagesQuery.isLoading ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">Buscando...</p>
                ) : pagesQuery.isError ? (
                  <p data-testid="status-wiki-list-error" className="p-5 text-center text-sm text-destructive">
                    No se pudo cargar la wiki.
                  </p>
                ) : pages.length === 0 ? (
                  <div className="space-y-2 p-5 text-center">
                    <BookText className="mx-auto h-7 w-7 text-muted-foreground/60" />
                    <p className="text-sm font-medium">
                      {search || tagFilter ? "No hay resultados" : "Todavía no hay páginas"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {canCreate
                        ? "Crea la primera página de esta sección."
                        : "La wiki empieza vacía. Elige una sección editable para crear páginas."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {pages.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        data-testid={`button-wiki-page-${item.id}`}
                        onClick={() => setSelectedPageId(item.id)}
                        className={`w-full rounded-md border px-3 py-3 text-left transition-colors ${
                          item.id === selectedId
                            ? "border-primary/40 bg-primary/5"
                            : "border-transparent hover:bg-accent"
                        }`}
                      >
                        <span className="flex items-start gap-2">
                          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{item.title}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              {scope === "all" && (
                                <span className="truncate">{item.moduleName ?? "General"}</span>
                              )}
              {item.attachmentCount > 0 && (
                                <span className="inline-flex items-center gap-1">
                                  <Upload className="h-3 w-3" /> {item.attachmentCount}
                                </span>
                              )}
                            </span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="min-h-[420px]">
            <CardContent className="p-5 sm:p-7">
              {selectedId === null ? (
                <div className="flex min-h-[340px] flex-col items-center justify-center text-center">
                  <BookText className="mb-3 h-10 w-10 text-muted-foreground/50" />
                  <h2 className="font-semibold">Wiki interna de Coordina ADG</h2>
                  <p className="mt-2 max-w-md text-sm text-muted-foreground">
                    Busca páginas y archivos o selecciona una sección para consultar su documentación.
                  </p>
                </div>
              ) : pageQueryResult.isLoading ? (
                <p className="py-16 text-center text-sm text-muted-foreground">Cargando página...</p>
              ) : pageQueryResult.isError || !page ? (
                <p data-testid="status-wiki-page-error" className="py-16 text-center text-sm text-destructive">
                  No se pudo cargar esta página.
                </p>
              ) : (
                <article data-testid={`article-wiki-page-${page.id}`} className="mx-auto max-w-4xl">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{page.moduleName ?? "General"}</Badge>
                        {page.canEdit && <Badge variant="outline">Editable</Badge>}
                      </div>
                      <h2 data-testid={`heading-wiki-page-${page.id}`} className="text-2xl font-bold tracking-tight">
                        {page.title}
                      </h2>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Actualizada {new Date(page.updatedAt).toLocaleDateString()}
                      </p>
                      {page.tags.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {page.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="font-normal">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    {(page.canEdit || page.canDelete) && (
                      <div className="flex shrink-0 gap-2">
                        {page.canEdit && (
                          <Button
                            data-testid="button-edit-wiki-page"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditorPage(page);
                              setEditorOpen(true);
                            }}
                          >
                            <Pencil className="mr-1.5 h-4 w-4" /> Editar
                          </Button>
                        )}
                        {page.canDelete && (
                          <Button
                            data-testid="button-delete-wiki-page"
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void removePage()}
                            disabled={deletePageMutation.isPending}
                            aria-label="Eliminar página"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="py-6">
                    <PageContent content={page.content} />
                  </div>

                  <section className="border-t pt-5">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">Archivos y enlaces adjuntos</h3>
                        <p className="text-xs text-muted-foreground">
                          Se admiten PDF, imágenes, formatos Microsoft, ZIP y RAR. Los enlaces externos deben usar HTTP o HTTPS. El texto de los formatos compatibles se indexa; PDF, imágenes y RAR se buscan por nombre.
                        </p>
                      </div>
                      {page.canUpload && (
                        <div className="flex flex-wrap gap-2">
                          <input
                            ref={fileInputRef}
                            data-testid="input-wiki-attachments"
                            type="file"
                            multiple
                            accept={WIKI_ATTACHMENT_ACCEPT}
                            className="hidden"
                            onChange={(event) => void uploadFiles(event.target.files)}
                          />
                          <Button
                            data-testid="button-upload-wiki-attachment"
                            size="sm"
                            variant="outline"
                            disabled={uploading}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload className="mr-1.5 h-4 w-4" />
                            {uploading ? "Subiendo..." : "Añadir archivos"}
                          </Button>
                          <Button
                            data-testid="button-add-wiki-external-link"
                            size="sm"
                            variant="outline"
                            onClick={() => setExternalLinkDialogOpen(true)}
                          >
                            <Link2 className="mr-1.5 h-4 w-4" />
                            Añadir enlace
                          </Button>
                        </div>
                      )}
                    </div>
                    {page.attachments.length === 0 && page.externalLinks.length === 0 ? (
                      <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                        No hay archivos ni enlaces adjuntos.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {page.externalLinks.map((externalLink) => (
                          <div
                            key={`external-${externalLink.id}`}
                            data-testid={`row-wiki-external-link-${externalLink.id}`}
                            className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                          >
                            <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <a
                                data-testid={`link-wiki-external-${externalLink.id}`}
                                href={externalLink.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate text-sm font-medium text-primary underline-offset-4 hover:underline"
                              >
                                {externalLink.title}
                              </a>
                              <div className="truncate text-xs text-muted-foreground">
                                {externalLinkHost(externalLink.url)}
                              </div>
                            </div>
                            {page.canDelete && (
                              <Button
                                data-testid={`button-delete-wiki-external-link-${externalLink.id}`}
                                size="icon"
                                variant="ghost"
                                onClick={() => void removeExternalLink(externalLink.id, externalLink.title)}
                                disabled={deleteExternalLinkMutation.isPending}
                                aria-label={`Retirar enlace ${externalLink.title}`}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        ))}
                        {page.attachments.map((attachment) => (
                          <div
                            key={attachment.id}
                            data-testid={`row-wiki-attachment-${attachment.id}`}
                            className="flex flex-wrap items-center gap-3 rounded-md border p-3"
                          >
                            {/\.(zip|rar)$/i.test(attachment.fileName) ? (
                              <FileArchive className="h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{attachment.fileName}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatSize(attachment.size)} · {attachmentStatus(attachment.indexStatus)}
                              </div>
                            </div>
                            <Button
                              data-testid={`button-download-wiki-attachment-${attachment.id}`}
                              size="icon"
                              variant="ghost"
                              onClick={() => void downloadAttachment(attachment.id, attachment.fileName)}
                              aria-label={`Descargar ${attachment.fileName}`}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                            {page.canDelete && (
                              <Button
                                data-testid={`button-delete-wiki-attachment-${attachment.id}`}
                                size="icon"
                                variant="ghost"
                                onClick={() => void removeAttachment(attachment.id)}
                                disabled={deleteAttachmentMutation.isPending}
                                aria-label={`Retirar ${attachment.fileName}`}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </article>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <PageEditorDialog
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditorPage(null);
        }}
        sectionName={
          editorPage
            ? moduleLabel(
                modules.find((module) => module.id === editorPage.moduleId),
              )
            : sectionName
        }
        moduleId={
          editorPage
            ? editorPage.moduleId
            : isGeneralScope
              ? null
              : selectedModuleId
        }
        page={editorPage}
        onSaved={(pageId) => void handlePageSaved(pageId)}
      />
      <Dialog
        open={externalLinkDialogOpen}
        onOpenChange={(open) => {
          setExternalLinkDialogOpen(open);
          if (!open) {
            setExternalLinkTitle("");
            setExternalLinkUrl("");
          }
        }}
      >
        <DialogContent>
          <form onSubmit={(event) => void addExternalLink(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Añadir enlace externo</DialogTitle>
              <DialogDescription>
                El enlace será visible para las personas autenticadas que pueden leer esta wiki. El acceso al archivo depende del servicio externo.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="wiki-external-link-title">Nombre del enlace</Label>
              <Input
                id="wiki-external-link-title"
                data-testid="input-wiki-external-link-title"
                value={externalLinkTitle}
                onChange={(event) => setExternalLinkTitle(event.target.value)}
                maxLength={240}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wiki-external-link-url">Dirección del archivo</Label>
              <Input
                id="wiki-external-link-url"
                data-testid="input-wiki-external-link-url"
                type="url"
                value={externalLinkUrl}
                onChange={(event) => setExternalLinkUrl(event.target.value)}
                maxLength={2048}
                placeholder="https://ejemplo.org/archivo"
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setExternalLinkDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                data-testid="button-submit-wiki-external-link"
                type="submit"
                disabled={addExternalLinkMutation.isPending}
              >
                {addExternalLinkMutation.isPending ? "Guardando..." : "Guardar enlace"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {editorsModule && (
        <EditorsDialog
          module={editorsModule}
          open={editorsModule !== null}
          onOpenChange={(open) => {
            if (!open) setEditorsModule(null);
          }}
        />
      )}
    </div>
  );
}