import { useEffect, useState } from "react";
import { Eye, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

export function PdfPreviewDialog({
  title,
  loadPdf,
  disabled = false,
}: {
  title: string;
  loadPdf: () => Promise<Blob>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [blobUrl, setBlobUrl] = useState("");

  useEffect(() => () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  const preview = async () => {
    setOpen(true);
    setLoading(true);
    setBlobUrl("");
    try {
      const blob = await loadPdf();
      const header = await blob.slice(0, 1024).text();
      if (!header.includes("%PDF-")) throw new Error("El archivo no es un PDF válido.");
      const pdfBlob = blob.type === "application/pdf"
        ? blob
        : new Blob([blob], { type: "application/pdf" });
      setBlobUrl(URL.createObjectURL(pdfBlob));
    } catch (error) {
      setOpen(false);
      toast({
        title: "No se pudo abrir el PDF",
        description: error instanceof Error ? error.message : "Comprueba tu conexión y tus permisos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        aria-label={`Ver ${title}`}
        title={`Ver ${title}`}
        disabled={disabled || loading}
        onClick={() => void preview()}
      >
        <Eye className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={(value) => {
        setOpen(value);
        if (!value && blobUrl) {
          URL.revokeObjectURL(blobUrl);
          setBlobUrl("");
        }
      }}>
        <DialogContent className="flex h-[92dvh] w-[min(96vw,1100px)] max-w-none flex-col gap-2 p-4 sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle className="truncate">{title}</DialogTitle>
            <DialogDescription>Vista previa privada del documento.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
                <LoaderCircle className="h-5 w-5 animate-spin" /> Abriendo documento…
              </div>
            ) : blobUrl ? (
              <iframe title={title} src={blobUrl} className="h-full w-full border-0" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function isPdfDocument(fileName?: string | null, contentType?: string | null) {
  return contentType?.split(";")[0]?.trim().toLowerCase() === "application/pdf"
    || /\.pdf$/i.test(fileName ?? "");
}
