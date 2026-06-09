import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInvitations,
  useCreateInvitation,
  useRevokeInvitation,
  useResendInvitation,
  useListProvinces,
  useListCenters,
  getListInvitationsQueryKey,
  type ListInvitationsParams,
  type CreateInvitationInput,
  type Role,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCw, Ban, Mail, Copy } from "lucide-react";

const ALL = "all";
const NONE = "none";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadmin",
  coordinator: "Coordinador/a",
  prospector: "Prospector/a",
  department_head: "Jefe/a de departamento",
  teacher: "Profesor/a",
  student: "Estudiante",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  accepted: "Aceptada",
  revoked: "Revocada",
  expired: "Caducada",
};

// Mirrors the backend INVITE_MATRIX (auth.ts). Keep in sync to avoid 403s.
function inviteRoleOptions(callerRole: string | undefined): Role[] {
  if (callerRole === "superadmin")
    return [
      "coordinator",
      "prospector",
      "department_head",
      "teacher",
      "student",
    ] as Role[];
  if (callerRole === "coordinator")
    return ["prospector", "department_head"] as Role[];
  if (callerRole === "department_head") return ["teacher"] as Role[];
  return [];
}

interface FormState {
  role: Role;
  provinceId: number | null;
  centerId: number | null;
  expiresInHours: string;
}

function CreateInvitationDialog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isSuperadmin = user?.role === "superadmin";
  const roleOptions = inviteRoleOptions(user?.role);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>({
    role: roleOptions[0],
    provinceId: user?.provinceId ?? null,
    centerId: null,
    expiresInHours: "168",
  });
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateInvitation();
  const { data: provinces = [] } = useListProvinces();
  const { data: centers = [] } = useListCenters();

  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const reset = () =>
    setForm({
      role: roleOptions[0],
      provinceId: user?.provinceId ?? null,
      centerId: null,
      expiresInHours: "168",
    });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const payload: CreateInvitationInput = {
      role: form.role,
      provinceId: form.provinceId,
      centerId: form.centerId,
      expiresInHours: form.expiresInHours.trim()
        ? Number(form.expiresInHours)
        : undefined,
    };
    try {
      const result = await createMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
      let copied = false;
      if (result.inviteUrl) {
        copied = await navigator.clipboard
          ?.writeText(result.inviteUrl)
          .then(() => true)
          .catch(() => false);
      }
      toast({
        title: "Invitación creada",
        description: copied
          ? "El enlace de invitación se ha copiado al portapapeles. Compártelo con la persona invitada."
          : "Comparte el enlace de invitación con la persona invitada.",
      });
      reset();
      setOpen(false);
    } catch {
      setError(
        "No se pudo crear la invitación. Comprueba tus permisos e inténtalo de nuevo.",
      );
    }
  };

  const centerOptions = centers.filter(
    (c) => form.provinceId == null || c.provinceId === form.provinceId,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva invitación
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva invitación</DialogTitle>
          <DialogDescription>
            Genera un código de invitación para un rol. Comparte el enlace
            resultante con la persona invitada; ella indicará su correo al
            crear la cuenta.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select
                value={form.role}
                onValueChange={(v) => set({ role: v as Role })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="expires">Validez (horas)</Label>
              <Input
                id="expires"
                inputMode="numeric"
                value={form.expiresInHours}
                onChange={(e) => set({ expiresInHours: e.target.value })}
                placeholder="168"
              />
            </div>
          </div>

          {isSuperadmin && (
            <div className="space-y-2">
              <Label>Provincia</Label>
              <Select
                value={form.provinceId ? String(form.provinceId) : NONE}
                onValueChange={(v) =>
                  set({
                    provinceId: v === NONE ? null : Number(v),
                    centerId: null,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Sin asignar</SelectItem>
                  {provinces.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Centro (opcional)</Label>
            <Select
              value={form.centerId ? String(form.centerId) : NONE}
              onValueChange={(v) =>
                set({ centerId: v === NONE ? null : Number(v) })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin asignar</SelectItem>
                {centerOptions.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? "Creando..." : "Crear invitación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_OPTIONS = ["pending", "accepted", "revoked", "expired"];

export default function InvitacionesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canManage = ["superadmin", "coordinator", "department_head"].includes(
    user?.role ?? "",
  );

  const [status, setStatus] = useState<string | null>(null);

  const params: ListInvitationsParams = {};
  if (status != null) params.status = status;

  const { data: invitations = [], isLoading } = useListInvitations(params);
  const revokeMut = useRevokeInvitation();
  const resendMut = useResendInvitation();

  const onRevoke = async (id: number, code: string) => {
    try {
      await revokeMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
      toast({ title: "Invitación revocada", description: code });
    } catch {
      toast({
        title: "No se pudo revocar",
        description: "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const onRenew = async (id: number) => {
    try {
      const result = await resendMut.mutateAsync({ id });
      await qc.invalidateQueries({ queryKey: getListInvitationsQueryKey() });
      let copied = false;
      if (result.inviteUrl) {
        copied = await navigator.clipboard
          ?.writeText(result.inviteUrl)
          .then(() => true)
          .catch(() => false);
      }
      toast({
        title: "Invitación renovada",
        description: copied
          ? "Se amplió la validez y el enlace se ha copiado al portapapeles."
          : "Se amplió la validez de la invitación.",
      });
    } catch {
      toast({
        title: "No se pudo renovar",
        description: "Inténtalo de nuevo.",
        variant: "destructive",
      });
    }
  };

  const onCopyLink = async (code: string) => {
    const url = `${window.location.origin}/register?token=${code}`;
    const ok = await navigator.clipboard
      ?.writeText(url)
      .then(() => true)
      .catch(() => false);
    toast({
      title: ok ? "Enlace copiado" : "No se pudo copiar",
      description: ok ? url : "Cópialo manualmente.",
      variant: ok ? undefined : "destructive",
    });
  };

  const statusVariant = (
    s: string,
  ): "default" | "secondary" | "destructive" | "outline" => {
    if (s === "pending") return "default";
    if (s === "accepted") return "secondary";
    if (s === "revoked") return "destructive";
    return "outline";
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("es-ES", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invitaciones</h1>
          <p className="text-muted-foreground">
            Gestiona las invitaciones de acceso a Coordina ADG.
          </p>
        </div>
        {canManage && <CreateInvitationDialog />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          value={status ?? ALL}
          onValueChange={(v) => setStatus(v === ALL ? null : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-sm text-muted-foreground">
        {isLoading
          ? "Cargando invitaciones..."
          : `${invitations.length} ${invitations.length === 1 ? "invitación" : "invitaciones"}`}
      </p>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Caduca</TableHead>
                {canManage && (
                  <TableHead className="text-right">Acciones</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && invitations.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 5 : 4}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No hay invitaciones con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
              {invitations.map((inv) => {
                const isPending = inv.status === "pending";
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <code className="text-xs">{inv.code}</code>
                        {inv.email && (
                          <span className="text-xs text-muted-foreground">
                            · {inv.email}
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ROLE_LABELS[inv.role] ?? inv.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(inv.status)}>
                        {STATUS_LABELS[inv.status] ?? inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(inv.expiresAt)}
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {isPending && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5"
                              onClick={() => onCopyLink(inv.code)}
                            >
                              <Copy className="h-4 w-4" />
                              Copiar enlace
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5"
                              disabled={resendMut.isPending}
                              onClick={() => onRenew(inv.id)}
                            >
                              <RefreshCw className="h-4 w-4" />
                              Renovar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-destructive hover:text-destructive"
                              disabled={revokeMut.isPending}
                              onClick={() => onRevoke(inv.id, inv.code)}
                            >
                              <Ban className="h-4 w-4" />
                              Revocar
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
