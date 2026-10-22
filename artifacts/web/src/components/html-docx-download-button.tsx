import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type Props = {
  fileName: string;
  loadHtml: () => Promise<Blob | { blob: Blob; baseUrl?: string; imageHeaders?: Record<string, string> }>;
  testId: string;
  disabled?: boolean;
  variant?: "outline" | "ghost";
  className?: string;
};

export function isHtmlDocumentName(fileName: string): boolean {
  return /\.html?$/i.test(fileName);
}

export function HtmlDocxDownloadButton({
  fileName,
  loadHtml,
  testId,
  disabled = false,
  variant = "outline",
  className,
}: Props) {
  const [busy, setBusy] = useState(false);

  const downloadDocx = async () => {
    if (busy || disabled) return;
    setBusy(true);
    try {
      const loaded = await loadHtml();
      const source = loaded instanceof Blob ? loaded : loaded.blob;
      const imageBaseUrl = loaded instanceof Blob ? undefined : loaded.baseUrl;
      const imageHeaders = loaded instanceof Blob ? undefined : loaded.imageHeaders;
      const { createHtmlDocx } = await import("@/lib/html-docx");
      const docx = await createHtmlDocx(await source.text(), fileName, imageBaseUrl, imageHeaders);
      const url = URL.createObjectURL(docx);
      const anchor = document.createElement("a");
      anchor.href = url;
      const baseName = fileName.replace(/\.html?$/i, "").trim() || "documento";
      anchor.download = `${baseName}.docx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({
        title: "No se pudo generar el DOCX",
        description: error instanceof Error ? error.message : "Comprueba tu sesión e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      className={className}
      onClick={() => void downloadDocx()}
      disabled={disabled || busy}
      aria-label={`Descargar ${fileName} como DOCX`}
      data-testid={testId}
    >
      <FileDown className="mr-1.5 h-4 w-4" />
      {busy ? "Preparando…" : "DOCX"}
    </Button>
  );
}
