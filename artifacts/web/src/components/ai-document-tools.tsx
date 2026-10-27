import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import {
  getGetWikiPageQueryKey,
  getListNormativaQueryKey,
  getListWikiPagesQueryKey,
  useAddWikiAttachment,
  useAddWikiExternalLink,
  useCheckNormativa,
  useCreateWikiPage,
  useGetWikiPage,
  useListModules,
  useListNormativa,
  useListWikiPages,
  useRequestWikiUploadUrl,
  useReviewNormativa,
  useUpdateWikiPage,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface AiDocumentSeed {
  id: number;
  title: string;
  content: string;
}

type ToolTab = "buscar" | "crear" | "normativa";

export function AiDocumentTools({
  seed,
  onSeedConsumed,
  askAssistant,
}: {
  seed: AiDocumentSeed | null;
  onSeedConsumed: () => void;
  askAssistant: (prompt: string, context: "curriculum" | "gdcan") => Promise<string | null>;
}) {
  const { user } = useAuth();
  const isSuperadmin = user?.role === "superadmin";
  const client = useQueryClient();
  const [tab, setTab] = useState<ToolTab>("buscar");
  const [search, setSearch] = useState("");
  const [selectedPageId, setSelectedPageId] = useState<number | null>(null);
  const [targetModule, setTargetModule] = useState("general");
  const [parentPageId, setParentPageId] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [pageContent, setPageContent] = useState("");
  const [tags, setTags] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [normativeDraft, setNormativeDraft] = useState("");
  const [normativeSource, setNormativeSource] = useState("");
  const [normativeParentId, setNormativeParentId] = useState("");
  const [normativeTitle, setNormativeTitle] = useState("");
  const [normativeEditPageId, setNormativeEditPageId] = useState<number | null>(null);
  const [normativeEditTitle, setNormativeEditTitle] = useState("");
  const [normativeEditContent, setNormativeEditContent] = useState("");
  const [normativeEditSource, setNormativeEditSource] = useState("");
  const [normativeEditConfirmed, setNormativeEditConfirmed] = useState(false);
  const [normativeBaseUpdatedAt, setNormativeBaseUpdatedAt] = useState<string | null>(null);
  const [showNormativeHistory, setShowNormativeHistory] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const searchQuery = useListWikiPages(
    { ...(search.trim() ? { q: search.trim() } : {}) },
    { query: { enabled: isSuperadmin && (tab === "buscar" || tab === "crear"), staleTime: 10_000 } },
  );
  const targetModuleId = targetModule === "general" ? null : Number(targetModule);
  const sectionPages = useListWikiPages(
    targetModuleId === null ? { globalOnly: true } : { moduleId: targetModuleId },
    { query: { enabled: isSuperadmin && tab === "crear" } },
  );
  const normativePages = useListWikiPages(
    { globalOnly: true, tag: "normativa" },
    { query: { enabled: isSuperadmin && tab === "normativa" } },
  );
  const modulesQuery = useListModules(
    {},
    { query: { enabled: isSuperadmin && tab === "crear" } },
  );
  const selectedPageQuery = useGetWikiPage(selectedPageId ?? 0, {
    query: { enabled: isSuperadmin && selectedPageId !== null },
  });
  const normativeEditQuery = useGetWikiPage(normativeEditPageId ?? 0, {
    query: { enabled: isSuperadmin && tab === "normativa" && normativeEditPageId !== null },
  });
  const publicationsQuery = useListNormativa({ status: showNormativeHistory ? "all" : "pending", offset: 0 }, {
    query: { enabled: isSuperadmin && tab === "normativa", refetchInterval: 20_000 },
  });

  const createPage = useCreateWikiPage();
  const addLink = useAddWikiExternalLink();
  const requestUpload = useRequestWikiUploadUrl();
  const addAttachment = useAddWikiAttachment();
  const runNormativeCheck = useCheckNormativa();
  const reviewPublication = useReviewNormativa();
  const updatePage = useUpdateWikiPage();
  const selectedPage =
    selectedPageQuery.data?.id === selectedPageId
      ? selectedPageQuery.data
      : undefined;
  const normativeEditPage =
    normativeEditQuery.data?.id === normativeEditPageId
      ? normativeEditQuery.data
      : undefined;

  useEffect(() => {
    if (!normativeEditPage || normativeBaseUpdatedAt !== null) return;
    setNormativeEditTitle(normativeEditPage.title);
    setNormativeEditContent(normativeEditPage.content);
    setNormativeBaseUpdatedAt(normativeEditPage.updatedAt);
    setNormativeEditConfirmed(false);
  }, [normativeEditPage?.id, normativeBaseUpdatedAt]);

  useEffect(() => {
    if (!seed) return;
    setTab("crear");
    setPageTitle(seed.title);
    setPageContent(seed.content);
    setTargetModule("general");
    setParentPageId("");
    setTags("");
    setError(null);
    setNotice(null);
    onSeedConsumed();
  }, [seed?.id]);

  const invalidateWiki = async (pageId?: number) => {
    await client.invalidateQueries({ queryKey: getListWikiPagesQueryKey() });
    if (pageId != null) {
      await client.invalidateQueries({ queryKey: getGetWikiPageQueryKey(pageId) });
    }
  };

  const savePage = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const parent = sectionPages.data?.items.find((page) => String(page.id) === parentPageId);
    const moduleId = parent?.moduleId ?? targetModuleId;
    setBusy(true);
    try {
      const created = await createPage.mutateAsync({
        data: {
          moduleId,
          parentId: parent?.id ?? null,
          title: pageTitle.trim(),
          content: pageContent.trim(),
          tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        },
      });
      await invalidateWiki(created.id);
      setSelectedPageId(created.id);
      setNotice("Página creada en Documentación. Ya aparece en la sección elegida.");
      setPageTitle("");
      setPageContent("");
      setTags("");
      setParentPageId("");
    } catch {
      setError("No se pudo crear la página. Comprueba el título, la sección y tus permisos.");
    } finally {
      setBusy(false);
    }
  };

  const saveLink = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedPage || !selectedPage.canUpload) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await addLink.mutateAsync({
        pageId: selectedPage.id,
        data: { title: linkTitle.trim(), url: linkUrl.trim() },
      });
      await invalidateWiki(selectedPage.id);
      setNotice("Enlace añadido a la sección.");
      setLinkTitle("");
      setLinkUrl("");
    } catch {
      setError("No se pudo añadir el enlace. Comprueba que la dirección sea válida y tus permisos.");
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    event.target.value = "";
    if (!files?.length || !selectedPage || !selectedPage.canUpload) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    let uploaded = 0;
    try {
      for (const file of Array.from(files)) {
        if (!file.size || file.size > MAX_UPLOAD_BYTES) {
          throw new Error(`«${file.name}» supera el límite de 50 MB o está vacío.`);
        }
        const contentType = file.type || "application/octet-stream";
        const upload = await requestUpload.mutateAsync({
          data: { pageId: selectedPage.id, fileName: file.name, size: file.size, contentType },
        });
        const response = await fetch(upload.uploadURL, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file,
        });
        if (!response.ok) throw new Error(`Falló la carga de «${file.name}».`);
        await addAttachment.mutateAsync({
          pageId: selectedPage.id,
          data: { fileName: file.name, objectPath: upload.objectPath, contentType, size: file.size },
        });
        uploaded++;
      }
      await invalidateWiki(selectedPage.id);
      setNotice(uploaded === 1 ? "Archivo añadido a la sección." : `${uploaded} archivos añadidos a la sección.`);
    } catch (reason) {
      await invalidateWiki(selectedPage.id);
      setError(reason instanceof Error ? reason.message : "No se pudieron añadir los archivos.");
    } finally {
      setBusy(false);
    }
  };

  const analyzePublication = async (publication: NonNullable<typeof publicationsQuery.data>["items"][number]) => {
    setError(null);
    const prompt = [
      "Analiza esta posible novedad normativa para Administración y Gestión en Canarias.",
      "No declares que una norma está vigente basándote solo en la detección. Distingue publicación, entrada en vigor y ámbito.",
      "No inventes el contenido que no figure en la fuente. Resume qué debería revisar una persona responsable y redacta una propuesta breve, marcada como borrador, con cita de la fuente oficial.",
      `Publicación: ${publication.title}`,
      `Identificador: ${publication.source} ${publication.officialId}`,
      `Fecha: ${publication.publishedAt ?? "sin fecha indicada"}`,
      `Motivo y datos detectados: ${publication.reason}`,
      `Fuente oficial: ${publication.url}`,
    ].join("\n");
    const reply = await askAssistant(prompt, "gdcan");
    if (!reply) return;
    setNormativeDraft(reply);
    setNormativeSource(publication.url);
    setNormativeEditSource(publication.url);
    setNormativeTitle(`Propuesta de revisión · ${publication.title}`.slice(0, 200));
    setNormativeParentId("");
    setTab("normativa");
  };

  const saveNormativeDraft = async (event: FormEvent) => {
    event.preventDefault();
    const parent = normativePages.data?.items.find((page) => String(page.id) === normativeParentId);
    if (!parent || !normativeDraft.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createPage.mutateAsync({
        data: {
          moduleId: null,
          parentId: parent.id,
          title: normativeTitle.trim(),
          content: `Propuesta generada con IA: pendiente de revisión humana y contraste de vigencia.\n\nFuente oficial detectada: ${normativeSource}\n\n## Borrador de revisión\n${normativeDraft.trim()}`,
          tags: ["normativa", "borrador-ia"],
        },
      });
      await Promise.all([
        invalidateWiki(created.id),
        client.invalidateQueries({ queryKey: getListNormativaQueryKey() }),
      ]);
      setSelectedPageId(created.id);
      setNotice("Propuesta guardada como borrador de Normativa. No se ha marcado como vigente ni se ha sustituido el texto existente.");
      setNormativeDraft("");
      setNormativeSource("");
      setNormativeParentId("");
    } catch {
      setError("No se pudo guardar el borrador. Comprueba que la página elegida siga disponible.");
    } finally {
      setBusy(false);
    }
  };

  const saveNormativeUpdate = async (event: FormEvent) => {
    event.preventDefault();
    if (!normativeEditPage || !normativeEditConfirmed || !normativeEditSource.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const latest = await normativeEditQuery.refetch();
      if (!latest.data || latest.data.updatedAt !== normativeBaseUpdatedAt) {
        setError("La página cambió desde que la abriste. Se ha conservado tu borrador; vuelve a cargar la versión actual y revisa las diferencias antes de guardar.");
        return;
      }
      const updated = await updatePage.mutateAsync({
        pageId: normativeEditPage.id,
        data: {
          title: normativeEditTitle.trim(),
          content: normativeEditContent,
          tags: normativeEditPage.tags,
        },
      });
      await invalidateWiki(normativeEditPage.id);
      setNormativeBaseUpdatedAt(updated.updatedAt);
      setNotice("Normativa actualizada después de tu confirmación. La publicación oficial y su vigencia siguen requiriendo revisión humana.");
      setNormativeEditConfirmed(false);
    } catch {
      setError("No se pudo actualizar la página normativa. Tu borrador se conserva para que puedas reintentarlo.");
    } finally {
      setBusy(false);
    }
  };

  const checkNormativa = async () => {
    setError(null);
    setNotice(null);
    try {
      await runNormativeCheck.mutateAsync();
      setNotice("Comprobación oficial solicitada. Los resultados aparecerán cuando termine el análisis.");
      window.setTimeout(() => void client.invalidateQueries({ queryKey: getListNormativaQueryKey() }), 2_000);
    } catch {
      setError("No se pudo iniciar la comprobación normativa.");
    }
  };

  const review = async (
    publication: NonNullable<typeof publicationsQuery.data>["items"][number],
    status: "reviewed" | "dismissed",
  ) => {
    const reviewNote = reviewNotes[publication.id]?.trim();
    if (!reviewNote) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await reviewPublication.mutateAsync({
        id: publication.id,
        data: { status, expectedStatus: "pending", reviewNote },
      });
      await client.invalidateQueries({ queryKey: getListNormativaQueryKey() });
      setReviewNotes((current) => ({ ...current, [publication.id]: "" }));
      setNotice(status === "reviewed" ? "Revisión registrada." : "Novedad descartada con motivo registrado.");
    } catch {
      setError("No se pudo guardar la revisión. La publicación pudo cambiar; actualiza la lista e inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  if (!isSuperadmin) return null;

  const buttonClass = (active: boolean) =>
    `rounded-md border px-3 py-2 text-sm ${active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"}`;
  const pages = searchQuery.data?.items ?? [];

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5" aria-label="Herramientas de Documentación con IA">
      <div>
        <h2 className="text-lg font-semibold">Documentación y Normativa</h2>
        <p className="text-sm text-muted-foreground">Busca, crea páginas, añade enlaces o archivos y prepara propuestas normativas para revisar.</p>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Herramientas del asistente">
        <button type="button" className={buttonClass(tab === "buscar")} onClick={() => setTab("buscar")}>Buscar documentación</button>
        <button type="button" className={buttonClass(tab === "crear")} onClick={() => setTab("crear")}>Crear o añadir recursos</button>
        <button type="button" className={buttonClass(tab === "normativa")} onClick={() => setTab("normativa")}>Revisar Normativa</button>
      </nav>

      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="rounded-md bg-muted p-3 text-sm">{notice}</p>}

      {tab === "buscar" && (
        <div className="space-y-3">
          <Input aria-label="Buscar en Documentación" placeholder="Buscar en páginas, archivos y enlaces..." value={search} onChange={(event) => setSearch(event.target.value)} />
          {searchQuery.isError && <p role="alert" className="text-sm text-destructive">No se pudo buscar en Documentación.</p>}
          {searchQuery.isLoading && <p className="text-sm text-muted-foreground">Buscando…</p>}
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {pages.map((page) => (
              <button key={page.id} type="button" onClick={() => setSelectedPageId(page.id)}
                className="w-full rounded-lg border p-3 text-left hover:bg-accent">
                <span className="font-medium">{page.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{page.moduleName ?? "Documentación general"} · {page.attachmentCount} archivo(s){page.tags.length ? ` · ${page.tags.join(", ")}` : ""}</span>
              </button>
            ))}
            {!searchQuery.isLoading && pages.length === 0 && <p className="text-sm text-muted-foreground">No se encontraron páginas con esos términos.</p>}
          </div>
          {selectedPage && selectedPageId !== null && (
            <article className="rounded-lg border p-3">
              <h3 className="font-semibold">{selectedPage.title}</h3>
              <p className="text-xs text-muted-foreground">{selectedPage.moduleName ?? "Documentación general"} · {selectedPage.externalLinks.length} enlace(s) · {selectedPage.attachments.length} archivo(s)</p>
              <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-sm">{selectedPage.content}</p>
              <Button className="mt-3" type="button" variant="outline" size="sm" onClick={() => setTab("crear")}>Añadir recurso a esta sección</Button>
            </article>
          )}
        </div>
      )}

      {tab === "crear" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <form className="space-y-3" onSubmit={savePage}>
            <h3 className="font-semibold">Crear página en una sección</h3>
            <label className="block space-y-1 text-sm">
              <span>Sección o módulo</span>
              <select className="h-10 w-full rounded-md border bg-background px-3" value={targetModule}
                onChange={(event) => { setTargetModule(event.target.value); setParentPageId(""); setSelectedPageId(null); }}>
                <option value="general">Documentación general</option>
                {(modulesQuery.data ?? []).map((module) => <option key={module.id} value={String(module.id)}>{module.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Página superior (opcional)</span>
              <select className="h-10 w-full rounded-md border bg-background px-3" value={parentPageId} onChange={(event) => setParentPageId(event.target.value)}>
                <option value="">Crear al nivel de la sección</option>
                {(sectionPages.data?.items ?? []).map((page) => <option key={page.id} value={String(page.id)}>{page.title}</option>)}
              </select>
            </label>
            <Input aria-label="Título de la nueva página" placeholder="Título" maxLength={200} required value={pageTitle} onChange={(event) => setPageTitle(event.target.value)} />
            <Textarea aria-label="Contenido de la nueva página" placeholder="Contenido o propuesta redactada con la IA" maxLength={100_000} required className="min-h-36" value={pageContent} onChange={(event) => setPageContent(event.target.value)} />
            <Input aria-label="Etiquetas de la página" placeholder="Etiquetas, separadas por comas" maxLength={500} value={tags} onChange={(event) => setTags(event.target.value)} />
            <Button type="submit" disabled={busy || !pageTitle.trim() || !pageContent.trim()}>{busy ? "Guardando…" : "Crear página"}</Button>
          </form>

          <div className="space-y-3">
            <h3 className="font-semibold">Añadir un enlace o archivo a una página existente</h3>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
              {(sectionPages.data?.items ?? []).map((page) => (
                <button key={page.id} type="button" onClick={() => setSelectedPageId(page.id)}
                  className={`w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${selectedPageId === page.id ? "bg-accent" : ""}`}>
                  {page.title}<span className="ml-2 text-xs text-muted-foreground">{page.moduleName ?? "General"}</span>
                </button>
              ))}
              {(sectionPages.data?.items.length ?? 0) === 0 && <p className="text-xs text-muted-foreground">No hay páginas en esta sección todavía.</p>}
            </div>
            {selectedPage && (
              <>
                <p className="text-sm">Destino: <strong>{selectedPage.title}</strong></p>
                {selectedPage.canUpload ? (
                  <>
                    <form className="space-y-2" onSubmit={saveLink}>
                      <Input aria-label="Título del enlace" placeholder="Nombre del recurso" maxLength={240} required value={linkTitle} onChange={(event) => setLinkTitle(event.target.value)} />
                      <Input aria-label="Dirección del enlace" placeholder="https://..." type="url" maxLength={2048} required value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} />
                      <Button type="submit" variant="outline" disabled={busy || !linkTitle.trim() || !linkUrl.trim()}>Añadir enlace</Button>
                    </form>
                    <label className="block space-y-2 text-sm">
                      <span>Subir archivos (hasta 50 MB por archivo)</span>
                      <Input aria-label="Subir archivos a la sección" type="file" multiple disabled={busy} onChange={(event) => void uploadFiles(event)} />
                    </label>
                  </>
                ) : <p className="text-sm text-muted-foreground">No tienes permiso para añadir recursos a esta página.</p>}
              </>
            )}
          </div>
        </div>
      )}

      {tab === "normativa" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">La IA prepara propuestas; no declara vigencia ni sustituye la revisión de la fuente oficial. El texto publicado no se cambia automáticamente.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setShowNormativeHistory((current) => !current)}>
                {showNormativeHistory ? "Ver pendientes" : "Ver historial"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void checkNormativa()}
                disabled={runNormativeCheck.isPending || publicationsQuery.data?.running || publicationsQuery.data?.enabled === false}>
              {publicationsQuery.data?.running ? "Comprobación en curso…" : runNormativeCheck.isPending ? "Solicitando…" : "Comprobar novedades oficiales"}
              </Button>
            </div>
          </div>
          {publicationsQuery.data?.enabled === false && <p className="text-sm text-muted-foreground">El seguimiento automático está configurado para la familia Administración y Gestión.</p>}
          {publicationsQuery.isError && <p role="alert" className="text-sm text-destructive">No se pudo consultar el seguimiento. Reintenta.</p>}
          {publicationsQuery.isLoading && <p className="text-sm">Consultando publicaciones detectadas…</p>}
          <div className="max-h-[28rem] space-y-3 overflow-y-auto">
            {(publicationsQuery.data?.items ?? []).map((publication) => (
              <article key={publication.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="font-medium">{publication.title}</h3>
                  <span className="text-xs text-muted-foreground">{publication.source} · {publication.publishedAt ?? "fecha no indicada"} · {publication.relevance}</span>
                </div>
                <p className="text-sm">{publication.reason}</p>
                <a href={publication.url} target="_blank" rel="noreferrer" className="break-all text-sm text-primary underline">{publication.url}</a>
                {publication.status === "pending" && <Button type="button" variant="outline" size="sm" disabled={busy || !publicationsQuery.data?.enabled}
                  onClick={() => void analyzePublication(publication)}>Analizar y proponer con IA</Button>
                }
                {publication.status !== "pending" && (
                  <p className="text-xs text-muted-foreground">Estado: {publication.status}{publication.reviewNote ? ` · ${publication.reviewNote}` : ""}</p>
                )}
                {publication.status === "pending" && <>
                <label className="block space-y-1 text-sm">
                  <span>Nota de revisión obligatoria</span>
                  <Textarea maxLength={2000} value={reviewNotes[publication.id] ?? ""}
                    onChange={(event) => setReviewNotes((current) => ({ ...current, [publication.id]: event.target.value }))}
                    placeholder="Indica qué has contrastado en la fuente oficial y tu decisión" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={busy || !(reviewNotes[publication.id] ?? "").trim()}
                    onClick={() => void review(publication, "reviewed")}>Marcar como revisada</Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy || !(reviewNotes[publication.id] ?? "").trim()}
                    onClick={() => void review(publication, "dismissed")}>Descartar con motivo</Button>
                </div>
                </>}
              </article>
            ))}
            {!publicationsQuery.isLoading && !publicationsQuery.isError && (publicationsQuery.data?.items.length ?? 0) === 0 &&
              <p className="text-sm text-muted-foreground">{showNormativeHistory ? "No hay publicaciones en el historial." : "No hay novedades pendientes de revisión."}</p>}
          </div>
          {normativeDraft && (
            <form className="space-y-3 rounded-lg border border-primary/30 p-4" onSubmit={saveNormativeDraft}>
              <h3 className="font-semibold">Guardar propuesta como borrador</h3>
              <p className="text-sm text-muted-foreground">Se creará una página hija en la sección normativa seleccionada. El contenido vigente quedará intacto.</p>
              <label className="block space-y-1 text-sm">
                <span>Página de Normativa relacionada</span>
                <select className="h-10 w-full rounded-md border bg-background px-3" required value={normativeParentId} onChange={(event) => setNormativeParentId(event.target.value)}>
                  <option value="">Selecciona la página</option>
                  {(normativePages.data?.items ?? []).map((page) => <option key={page.id} value={String(page.id)}>{page.title}</option>)}
                </select>
              </label>
              <Input aria-label="Título del borrador normativo" value={normativeTitle} maxLength={200} required onChange={(event) => setNormativeTitle(event.target.value)} />
              <Textarea aria-label="Propuesta normativa generada" value={normativeDraft} maxLength={50_000} className="min-h-40" required onChange={(event) => setNormativeDraft(event.target.value)} />
              <Button type="submit" disabled={busy || !normativeParentId || !normativeDraft.trim()}>Crear borrador para revisión</Button>
            </form>
          )}
          <form className="space-y-3 rounded-lg border p-4" onSubmit={saveNormativeUpdate}>
            <h3 className="font-semibold">Actualizar una página normativa</h3>
            <p className="text-sm text-muted-foreground">Se carga el texto vigente para que puedas revisarlo y editarlo. La propuesta de IA solo se incorpora si la añades y confirmas el guardado.</p>
            <label className="block space-y-1 text-sm">
              <span>Página de Normativa</span>
              <select className="h-10 w-full rounded-md border bg-background px-3" required
                value={normativeEditPageId == null ? "" : String(normativeEditPageId)}
                onChange={(event) => {
                  setNormativeEditPageId(event.target.value ? Number(event.target.value) : null);
                  setNormativeBaseUpdatedAt(null);
                  setNormativeEditConfirmed(false);
                }}>
                <option value="">Selecciona una página para editar</option>
                {(normativePages.data?.items ?? []).map((page) => <option key={page.id} value={String(page.id)}>{page.title}</option>)}
              </select>
            </label>
            {normativeEditPage && <>
              <details className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">Ver contenido cargado actualmente</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-xs">{normativeEditPage.content}</pre>
              </details>
              <Input aria-label="Título actualizado de la página normativa" value={normativeEditTitle} maxLength={200} required
                onChange={(event) => setNormativeEditTitle(event.target.value)} />
              <Textarea aria-label="Texto actualizado de la normativa" value={normativeEditContent} maxLength={100_000} className="min-h-56"
                onChange={(event) => { setNormativeEditContent(event.target.value); setNormativeEditConfirmed(false); }} required />
              {normativeDraft && <Button type="button" variant="outline" onClick={() => {
                setNormativeEditContent((current) => `${current.trim()}\n\n## Propuesta para revisión\n${normativeDraft.trim()}`.trim());
                setNormativeEditConfirmed(false);
              }}>Añadir la propuesta de IA al texto</Button>}
              <Input aria-label="Fuente oficial consultada" type="url" placeholder="URL de la publicación oficial que has contrastado"
                value={normativeEditSource} maxLength={2048} required onChange={(event) => setNormativeEditSource(event.target.value)} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={normativeEditConfirmed} onChange={(event) => setNormativeEditConfirmed(event.target.checked)} />
                <span>He contrastado la fuente oficial, revisado el texto completo y confirmo que quiero actualizar esta página.</span>
              </label>
              <Button type="submit" disabled={busy || !normativeEditConfirmed || !normativeEditSource.trim() || !normativeEditContent.trim()}>
                {busy ? "Guardando…" : "Actualizar página normativa"}
              </Button>
            </>}
          </form>
        </div>
      )}
    </section>
  );
}
