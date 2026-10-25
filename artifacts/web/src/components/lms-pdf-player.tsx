import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

export function LmsPdfPlayer({ title, loadPdf }: {
  title: string;
  loadPdf: () => Promise<ArrayBuffer>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [documentFile, setDocumentFile] = useState<PdfDocument | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [viewportVersion, setViewportVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    setLoading(true);
    setError("");
    setDocumentFile(null);
    setPage(1);

    void (async () => {
      try {
        const bytes = await loadPdf();
        if (bytes.byteLength > 50 * 1024 * 1024) {
          throw new Error("Este PDF supera los 50 MB y no se puede abrir en el aula.");
        }
        task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          enableXfa: false,
        });
        const opened = await task.promise;
        if (cancelled) {
          await task.destroy();
          return;
        }
        setDocumentFile(opened);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "No se pudo abrir el PDF.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [loadPdf, attempt]);

  useEffect(() => {
    if (!documentFile || !canvasRef.current || !viewerRef.current) return;
    let cancelled = false;
    let rendering: { cancel: () => void; promise: Promise<void> } | undefined;

    void (async () => {
      try {
        const pdfPage = await documentFile.getPage(page);
        if (cancelled || !canvasRef.current || !viewerRef.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.max(320, viewerRef.current.clientWidth - 32);
        const viewport = pdfPage.getViewport({ scale: Math.min(width / base.width, 1.8) });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const canvas = canvasRef.current;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("aria-label", `Página ${page} de ${documentFile.numPages}`);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No se pudo iniciar el visor de PDF.");
        rendering = pdfPage.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
        });
        await rendering.promise;
      } catch (reason) {
        if (!cancelled && (reason as { name?: string })?.name !== "RenderingCancelledException") {
          setError("No se pudo mostrar esta página del PDF.");
        }
      }
    })();

    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [documentFile, page, viewportVersion]);

  useEffect(() => {
    if (!documentFile) return;
    const resize = () => setViewportVersion((current) => current + 1);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [documentFile]);

  return (
    <section aria-label={`Visor PDF: ${title}`} className="overflow-hidden rounded-xl border bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={!documentFile || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}>Anterior</Button>
          <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {documentFile ? `${page} / ${documentFile.numPages}` : "—"}
          </span>
          <Button type="button" variant="outline" size="sm" disabled={!documentFile || page >= documentFile.numPages}
            onClick={() => setPage((current) => Math.min(documentFile?.numPages ?? current, current + 1))}>Siguiente</Button>
        </div>
      </div>
      <div ref={viewerRef} className="flex h-[min(72vh,860px)] min-h-[420px] items-start justify-center overflow-auto p-4">
        {loading ? <div role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Abriendo PDF…</div>
          : error ? <div role="alert" className="space-y-3 py-12 text-center text-sm text-destructive">
            <p>{error}</p>
            <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
          </div>
            : <canvas ref={canvasRef} className="max-w-full bg-white shadow-sm" aria-label={`Página ${page}`} />}
      </div>
    </section>
  );
}
