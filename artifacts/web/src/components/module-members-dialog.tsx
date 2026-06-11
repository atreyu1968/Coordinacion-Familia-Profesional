import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListModuleMembers,
  useListUsers,
  useAddModuleMember,
  useUpdateModuleMember,
  useRemoveModuleMember,
  useEnrollInModule,
  useLeaveModule,
  getListModuleMembersQueryKey,
  getListModulesQueryKey,
  type Module,
  type ModuleMember,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Crown, Plus, Trash2, UserMinus, UserPlus } from "lucide-react";

// ---------------------------------------------------------------------------
// Self-enrollment toggle: any authenticated user may enroll into / leave a
// module that is within their scope (multi-module).
// ---------------------------------------------------------------------------
export function EnrollButton({ module }: { module: Module }) {
  const qc = useQueryClient();
  const enrollMut = useEnrollInModule();
  const leaveMut = useLeaveModule();
  const busy = enrollMut.isPending || leaveMut.isPending;

  const onToggle = async () => {
    try {
      if (module.enrolled) {
        await leaveMut.mutateAsync({ moduleId: module.id });
      } else {
        await enrollMut.mutateAsync({ moduleId: module.id });
      }
      await qc.invalidateQueries({ queryKey: getListModulesQueryKey() });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo actualizar tu inscripción.",
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      size="sm"
      variant={module.enrolled ? "outline" : "default"}
      onClick={onToggle}
      disabled={busy}
      className="gap-1.5"
    >
      {module.enrolled ? (
        <>
          <UserMinus className="w-3.5 h-3.5" /> Salir
        </>
      ) : (
        <>
          <UserPlus className="w-3.5 h-3.5" /> Inscribirme
        </>
      )}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// Member management (managers in scope): add/remove teachers and designate or
// transfer the single per-module coordinator.
// ---------------------------------------------------------------------------
export function ModuleMembersDialog({
  module,
  trigger,
  canDesignateCoordinator = true,
}: {
  module: Module;
  trigger: ReactNode;
  /**
   * Whether the viewer may designate/transfer the module coordinator. Managers
   * (superadmin / provincial coordinator / department head) can; a module's own
   * coordinator can manage the roster but not change the coordinator.
   */
  canDesignateCoordinator?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: members = [], isLoading } = useListModuleMembers(module.id, {
    query: {
      enabled: open,
      queryKey: getListModuleMembersQueryKey(module.id),
    },
  });
  const { data: teachers = [] } = useListUsers({ role: "teacher" });

  const addMut = useAddModuleMember();
  const updateMut = useUpdateModuleMember();
  const removeMut = useRemoveModuleMember();

  const [selectedTeacher, setSelectedTeacher] = useState("");

  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: getListModuleMembersQueryKey(module.id),
    });
    await qc.invalidateQueries({ queryKey: getListModulesQueryKey() });
  };

  const memberIds = new Set(members.map((m) => m.userId));
  const available = teachers.filter((t) => !memberIds.has(t.id));

  const onAdd = async () => {
    if (!selectedTeacher) return;
    try {
      await addMut.mutateAsync({
        moduleId: module.id,
        data: { userId: Number(selectedTeacher) },
      });
      setSelectedTeacher("");
      await refresh();
    } catch {
      toast({
        title: "Error",
        description: "No se pudo añadir al profesor.",
        variant: "destructive",
      });
    }
  };

  const onToggleCoordinator = async (m: ModuleMember) => {
    try {
      await updateMut.mutateAsync({
        moduleId: module.id,
        userId: m.userId,
        data: { role: m.role === "coordinator" ? "member" : "coordinator" },
      });
      await refresh();
    } catch {
      toast({
        title: "Error",
        description: "No se pudo cambiar el coordinador del módulo.",
        variant: "destructive",
      });
    }
  };

  const onRemove = async (m: ModuleMember) => {
    try {
      await removeMut.mutateAsync({ moduleId: module.id, userId: m.userId });
      await refresh();
    } catch {
      toast({
        title: "Error",
        description: "No se pudo quitar al profesor.",
        variant: "destructive",
      });
    }
  };

  const busy =
    addMut.isPending || updateMut.isPending || removeMut.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Miembros · {module.name}</DialogTitle>
          <DialogDescription>
            Inscribe profesorado y designa al coordinador del módulo (uno por
            módulo). El coordinador modera el foro y crea videoconferencias.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <Select value={selectedTeacher} onValueChange={setSelectedTeacher}>
              <SelectTrigger>
                <SelectValue placeholder="Añadir profesor/a..." />
              </SelectTrigger>
              <SelectContent>
                {available.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No hay profesorado disponible
                  </SelectItem>
                ) : (
                  available.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={onAdd}
            disabled={!selectedTeacher || busy}
            className="gap-1.5"
          >
            <Plus className="w-4 h-4" /> Añadir
          </Button>
        </div>

        <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-1.5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Cargando...
            </p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no hay miembros en este módulo.
            </p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 rounded-md border p-2.5"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate flex items-center gap-1.5">
                    {m.userName ?? `Usuario #${m.userId}`}
                    {m.role === "coordinator" && (
                      <Badge className="gap-1">
                        <Crown className="w-3 h-3" /> Coordinador
                      </Badge>
                    )}
                  </div>
                  {m.email && (
                    <div className="text-xs text-muted-foreground truncate">
                      {m.email}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canDesignateCoordinator && (
                    <Button
                      size="sm"
                      variant={
                        m.role === "coordinator" ? "secondary" : "outline"
                      }
                      onClick={() => onToggleCoordinator(m)}
                      disabled={busy}
                      className="gap-1.5"
                    >
                      <Crown className="w-3.5 h-3.5" />
                      {m.role === "coordinator"
                        ? "Quitar coord."
                        : "Coordinador"}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onRemove(m)}
                    disabled={busy}
                    className="text-destructive hover:text-destructive"
                    aria-label="Quitar miembro"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
