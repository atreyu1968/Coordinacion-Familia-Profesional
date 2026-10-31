import { useState, type FormEvent } from "react";
import { useRecordAgreementPosition, type AgreementWorkspace } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  notificationWarningOf,
  buildPositionPayload,
  ownParticipant,
  POSITION_LABELS,
  positionNeedsReason,
  type PositionValue,
} from "@/lib/forum-agreement";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { describeAgreementError, useInvalidateAgreement } from "./shared";

const OPTIONS: PositionValue[] = ["a_favor", "con_reservas", "en_contra"];

export function PositionForm({ ws }: { ws: AgreementWorkspace }) {
  const { user } = useAuth();
  const me = ownParticipant(ws, user?.id);
  const mine = ws.positions.find((p) => p.userId === user?.id && p.version === ws.agreement?.version);
  const mut = useRecordAgreementPosition();
  const invalidate = useInvalidateAgreement(ws.threadId);
  const [position, setPosition] = useState<PositionValue | null>(mine?.position ?? null);
  const [reason, setReason] = useState(mine?.reason ?? "");
  const [centerId, setCenterId] = useState<number | null>(
    mine?.centerId ?? (me?.centers.length === 1 ? me.centers[0].id : null),
  );
  const [error, setError] = useState<string | null>(null);

  if (!me) {
    return <p className="text-xs text-muted-foreground">No figuras en el censo fijado al abrir esta consulta, así que no puedes posicionarte. Puedes seguir debatiendo en el hilo.</p>;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const check = buildPositionPayload(ws, user?.id, { position, reason, centerId });
    if (!check.ok) return setError(check.error);
    try {
      const res = await mut.mutateAsync({ threadId: ws.threadId, data: check.payload });
      const warn = notificationWarningOf(res);
      toast({ title: "Posición registrada", description: warn ? `Registrada, pero: ${warn}` : "Queda visible con tu nombre y centro." });
      await invalidate();
    } catch (err) {
      setError(describeAgreementError(err, "No se pudo registrar tu posición."));
      await invalidate();
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-dashed p-3" data-testid="form-agreement-position">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{mine ? "Cambiar mi posición" : "Mi posición"}</p>
        {mine && (
          <p className="text-[11px] text-muted-foreground">Actual: {POSITION_LABELS[mine.position]}. El cambio queda en el historial.</p>
        )}
      </div>
      <div role="radiogroup" aria-label="Posición" className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={position === o}
            onClick={() => setPosition(o)}
            data-testid={`radio-position-${o}`}
            className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
              position === o
                ? o === "a_favor"
                  ? "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                  : o === "con_reservas"
                    ? "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-rose-500 bg-rose-50 text-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                : "hover:bg-accent"
            }`}
          >
            {POSITION_LABELS[o]}
          </button>
        ))}
      </div>
      {me.centers.length > 1 ? (
        <div className="space-y-1">
          <Label className="text-xs">Centro desde el que te posicionas *</Label>
          <Select value={centerId != null ? String(centerId) : ""} onValueChange={(v) => setCenterId(Number(v))}>
            <SelectTrigger data-testid="select-position-center"><SelectValue placeholder="Elige centro" /></SelectTrigger>
            <SelectContent>
              {me.centers.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Centro: {me.centers[0]?.name ?? "sin centro asignado"}</p>
      )}
      <div className="space-y-1">
        <Label htmlFor="position-reason" className="text-xs">
          Motivo o enmienda {position && positionNeedsReason(position) ? "*" : "(opcional)"}
        </Label>
        <Textarea
          id="position-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={position && positionNeedsReason(position) ? "Explica qué cambiarías o por qué no estás de acuerdo." : "Puedes añadir un comentario o una enmienda concreta."}
          data-testid="input-position-reason"
        />
      </div>
      {error && <p role="alert" className="text-sm font-medium text-destructive" data-testid="text-position-error">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={mut.isPending} data-testid="button-submit-position">
          {mut.isPending ? "Registrando..." : mine ? "Actualizar posición" : "Registrar posición"}
        </Button>
      </div>
    </form>
  );
}
