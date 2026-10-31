import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListWikiPagesQueryKey,
  usePublishForumAgreement,
  type AgreementWorkspace,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { BookCheck } from "lucide-react";
import { describeAgreementError, PlainTextPreview, useInvalidateAgreement } from "./shared";
import { notificationWarningOf, STATUS_LABELS } from "@/lib/forum-agreement";

export function PublishDialog({
  ws,
  open,
  onOpenChange,
}: {
  ws: AgreementWorkspace;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const a = ws.agreement;
  const qc = useQueryClient();
  const mut = usePublishForumAgreement();
  const invalidate = useInvalidateAgreement(ws.threadId);
  const [documentConfirmed, setDocumentConfirmed] = useState(false);
  const [referenceOnlyConfirmed, setReferenceOnlyConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!a) return null;

  const onPublish = async () => {
    setError(null);
    if (!a.documentUrl) return setError("Vincula primero el documento de Nextcloud de la versión final.");
    if (!documentConfirmed || !referenceOnlyConfirmed) return setError("Marca las dos confirmaciones para publicar.");
    try {
      const res = await mut.mutateAsync({
        threadId: ws.threadId,
        data: { revision: a.revision, version: a.version, documentConfirmed: true, referenceOnlyConfirmed: true },
      });
      await Promise.all([invalidate(), qc.invalidateQueries({ queryKey: getListWikiPagesQueryKey() })]);
      const warn = notificationWarningOf(res);
      toast({ title: "Publicado en Documentación", description: warn ? `Publicado, pero: ${warn}` : undefined });
      onOpenChange(false);
    } catch (err) {
      setError(describeAgreementError(err, "No se pudo publicar."));
      await invalidate();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v) {
          setDocumentConfirmed(false);
          setReferenceOnlyConfirmed(false);
          setError(null);
        }
      }}
    >
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publicar versión {a.version} en Documentación</DialogTitle>
          <DialogDescription>
            Se crea una página nueva de referencia con el estado «{STATUS_LABELS[a.status]}». Las páginas ya publicadas no se modifican.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3">
          <PlainTextPreview text={a.proposedText} compact />
        </div>
        <p className="text-xs text-muted-foreground">
          Antes de publicar solo se comprueba que el servicio Nextcloud está disponible; el servidor no lee el archivo. Tu confirmación queda registrada como garantía humana. Si el proveedor no responde no se crea ninguna página.
        </p>
        <div className="space-y-2">
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox checked={documentConfirmed} onCheckedChange={(v) => setDocumentConfirmed(v === true)} className="mt-0.5" data-testid="checkbox-publish-document" />
            <span>He abierto el documento enlazado, existe, corresponde a esta versión y tenemos derecho a difundirlo.</span>
          </label>
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <Checkbox checked={referenceOnlyConfirmed} onCheckedChange={(v) => setReferenceOnlyConfirmed(v === true)} className="mt-0.5" data-testid="checkbox-publish-reference" />
            <span>Entiendo que se publica como referencia intercentros, no como aprobación oficial ni norma de obligado cumplimiento.</span>
          </label>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-publish-error">{error}</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onPublish} disabled={mut.isPending} className="gap-1.5" data-testid="button-confirm-publish">
            <BookCheck className="h-4 w-4" /> {mut.isPending ? "Comprobando..." : "Publicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
