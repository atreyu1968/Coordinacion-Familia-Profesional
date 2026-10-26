import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]>;

function PdfPage({ documentFile, page, width, scrollRoot }: {
  documentFile: PdfDocument;
  page: number;
  width: number;
  scrollRoot: HTMLDivElement | null;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [aspectRatio, setAspectRatio] = useState(1 / Math.SQRT2);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!pageRef.current || !scrollRoot) return;
    const observer = new IntersectionObserver(([entry]) => {
      setNearViewport(entry.isIntersecting);
    }, { root: scrollRoot, rootMargin: "1000px 0px" });
    observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    if (!nearViewport || !canvasRef.current) return;
    let cancelled = false;
    let rendering: { cancel: () => void; promise: Promise<void> } | undefined;
    const canvas = canvasRef.current;
    setError(false);

    void (async () => {
      try {
        const pdfPage = await documentFile.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setAspectRatio(base.width / base.height);
        const viewport = pdfPage.getViewport({ scale: Math.min(width / base.width, 1.8) });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
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
          setError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [documentFile, page, width, nearViewport]);

  return (
    <div ref={pageRef} className="w-full shrink-0" style={{ aspectRatio }}>
      {error ? <p role="alert" className="p-4 text-sm text-destructive">No se pudo mostrar la página {page}.</p>
        : nearViewport ? <canvas ref={canvasRef} className="h-full w-full bg-white shadow-sm" role="img"
          aria-label={`Página ${page} de ${documentFile.numPages}`} />
          : <div className="h-full w-full bg-white shadow-sm" aria-label={`Página ${page} de ${documentFile.numPages}`} />}
    </div>
  );
}

export function LmsPdfPlayer({ title, loadPdf }: {
  title: string;
  loadPdf: () => Promise<ArrayBuffer>;
}) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [documentFile, setDocumentFile] = useState<PdfDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    setLoading(true);
    setError("");
    setDocumentFile(null);
    if (viewerRef.current) viewerRef.current.scrollTop = 0;

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
    const viewer = viewerRef.current;
    if (!viewer) return;
    const resize = () => {
      setWidth(Math.max(1, viewer.clientWidth - 32));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewer);
    return () => observer.disconnect();
  }, []);

  return (
    <section aria-label={`Visor PDF: ${title}`} className="overflow-hidden rounded-xl border bg-muted/30">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {documentFile ? `${documentFile.numPages} páginas · Desplazamiento vertical` : "—"}
        </span>
      </div>
      <div ref={viewerRef} role="region" aria-label="Páginas del PDF" tabIndex={0}
        className="h-[min(72vh,860px)] min-h-[420px] overflow-auto p-4">
        {loading ? <div role="status" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Abriendo PDF…</div>
          : error ? <div role="alert" className="space-y-3 py-12 text-center text-sm text-destructive">
            <p>{error}</p>
            <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Reintentar</Button>
          </div>
            : documentFile && <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              {Array.from({ length: documentFile.numPages }, (_, index) => (
                <PdfPage key={index} documentFile={documentFile} page={index + 1}
                  width={Math.min(width, 1024)} scrollRoot={viewerRef.current} />
              ))}
            </div>}
      </div>
    </section>
  );
}
