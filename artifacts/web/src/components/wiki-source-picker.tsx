import { useState } from "react";
import { Link } from "wouter";
import {
  useListWikiPages,
  useGetWikiPage,
  getListWikiPagesQueryKey,
  getGetWikiPageQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookText, Paperclip, RefreshCw } from "lucide-react";

export const wikiAttachmentUrl = (id: number) => `/api/wiki/attachments/${id}/download`;

/**
 * Pick an existing Documentación attachment of this module using the caller's
 * own read permissions. Only titles and file names are shown; no contents.
 */
export function WikiSourcePicker({
  moduleId,
  value,
  onSelect,
}: {
  moduleId: number;
  value: string;
  onSelect: (url: string) => void;
}) {
  const params = { moduleId };
  const pages = useListWikiPages(params, {
    query: { queryKey: getListWikiPagesQueryKey(params), retry: false, refetchOnWindowFocus: true },
  });
  const modulePages = (pages.data?.items ?? []).filter((p) => p.moduleId === moduleId && p.attachmentCount > 0);
  const [pageId, setPageId] = useState<number | null>(null);
  const page = useGetWikiPage(pageId ?? 0, {
    query: { queryKey: getGetWikiPageQueryKey(pageId ?? 0), enabled: pageId != null, retry: false },
  });
  const fallback = (
    <Link href={`/documentacion?module=${moduleId}`} className="text-xs text-primary underline" data-testid="link-open-documentacion">
      Abrir Documentación para añadir el original
    </Link>
  );

  return (
    <div className="space-y-2 rounded-md border p-2.5" data-testid="picker-wiki-source">
      <p className="text-xs font-medium flex items-center gap-1.5"><BookText className="w-3.5 h-3.5" /> Adjunto de Documentación del módulo</p>
      {pages.isLoading ? (
        <div className="h-9 rounded bg-muted animate-pulse" />
      ) : pages.isError ? (
        <div className="flex items-center justify-between gap-2 text-xs text-destructive">
          <span>No se pudo cargar la Documentación.</span>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1" onClick={() => void pages.refetch()} data-testid="button-retry-wiki-pages">
            <RefreshCw className="w-3 h-3" /> Reintentar
          </Button>
        </div>
      ) : modulePages.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay páginas de este módulo con adjuntos a los que tengas acceso. {fallback}</p>
      ) : (
        <>
          <Select value={pageId != null ? String(pageId) : undefined} onValueChange={(v) => setPageId(Number(v))}>
            <SelectTrigger className="h-9" data-testid="select-wiki-page"><SelectValue placeholder="Elige una página" /></SelectTrigger>
            <SelectContent className="max-h-64">
              {modulePages.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>{p.title} ({p.attachmentCount})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {pageId != null && (
            page.isLoading ? (
              <div className="h-16 rounded bg-muted animate-pulse" />
            ) : page.isError ? (
              <p className="text-xs text-destructive">No tienes acceso a esta página o ya no existe.</p>
            ) : (page.data?.attachments ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">Esta página no tiene adjuntos. {fallback}</p>
            ) : (
              <ul className="max-h-48 overflow-y-auto overscroll-contain divide-y rounded border">
                {page.data!.attachments.map((a) => {
                  const url = wikiAttachmentUrl(a.id);
                  const active = value.trim() === url;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(url)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent ${active ? "bg-primary/10 font-medium text-primary" : ""}`}
                        aria-pressed={active}
                        data-testid={`button-pick-attachment-${a.id}`}
                      >
                        <Paperclip className="w-3 h-3 shrink-0" />
                        <span className="truncate">{a.fileName}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          )}
          {fallback}
        </>
      )}
    </div>
  );
}
