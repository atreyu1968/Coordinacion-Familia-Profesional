import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAcademicYears,
  useCreateAcademicYear,
  useSetActiveAcademicYear,
  useTransitionAcademicYear,
  useOpenYearConfirmation,
  useRenameAcademicYear,
  useDeleteAcademicYear,
  useListYearConfirmations,
  getListAcademicYearsQueryKey,
  getListYearConfirmationsQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Plus,
  Star,
  ArrowRightLeft,
  MailCheck,
  Pencil,
  Trash2,
  AlertTriangle,
} from "lucide-react";

export default function AcademicYearsSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useListAcademicYears();
  const years = data?.years ?? [];
  const activeYear = data?.activeYear ?? null;

  const createMut = useCreateAcademicYear();
  const setActiveMut = useSetActiveAcademicYear();
  const renameMut = useRenameAcademicYear();
  const deleteMut = useDeleteAcademicYear();

  const [newName, setNewName] = useState("");
  const [activateTarget, setActivateTarget] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListAcademicYearsQueryKey() });

  const onCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createMut.mutateAsync({ data: { name } });
      await invalidate();
      setNewName("");
      toast({ title: "Curso creado", description: name });
    } catch {
      toast({
        title: "No se pudo crear el curso",
        description: "Puede que ya exista un curso con ese nombre.",
        variant: "destructive",
      });
    }
  };

  const onSetActive = async (name: string) => {
    try {
      await setActiveMut.mutateAsync({ data: { name } });
      await invalidate();
      toast({ title: "Curso activo actualizado", description: name });
    } catch {
      toast({
        title: "No se pudo activar el curso",
        variant: "destructive",
      });
    } finally {
      setActivateTarget(null);
      setAcknowledged(false);
    }
  };

  const onRename = async () => {
    if (renameId == null) return;
    const name = renameValue.trim();
    if (!name) return;
    try {
      await renameMut.mutateAsync({ id: renameId, data: { name } });
      await invalidate();
      toast({ title: "Curso renombrado", description: name });
      setRenameId(null);
      setRenameValue("");
    } catch {
      toast({
        title: "No se pudo renombrar el curso",
        variant: "destructive",
      });
    }
  };

  const onDelete = async (id: number, name: string) => {
    try {
      await deleteMut.mutateAsync({ id });
      await invalidate();
      toast({ title: "Curso eliminado", description: name });
    } catch {
      toast({
        title: "No se pudo eliminar el curso",
        description: "No puedes eliminar el curso activo.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Cursos académicos</CardTitle>
          </div>
          <CardDescription>
            Lista oficial de cursos. El curso activo filtra grupos, asignaciones
            y oferta formativa en toda la aplicación.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="new-year">Nuevo curso</Label>
              <Input
                id="new-year"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="2026/2027"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onCreate();
                  }
                }}
              />
            </div>
            <Button
              onClick={() => void onCreate()}
              disabled={createMut.isPending || !newName.trim()}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Añadir
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curso</TableHead>
                  <TableHead className="text-right">Grupos</TableHead>
                  <TableHead className="text-right">Asignaciones</TableHead>
                  <TableHead className="text-right">Oferta</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center">
                      Cargando...
                    </TableCell>
                  </TableRow>
                ) : years.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Aún no hay cursos registrados.
                    </TableCell>
                  </TableRow>
                ) : (
                  years.map((y) => {
                    const isActive = y.name === activeYear;
                    return (
                      <TableRow key={y.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {y.name}
                            {isActive && (
                              <Badge className="gap-1">
                                <Star className="h-3 w-3" /> Activo
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {y.groupCount ?? 0}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {y.assignmentCount ?? 0}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {y.offerCount ?? 0}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {!isActive && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5"
                                onClick={() => {
                                  setActivateTarget(y.name);
                                  setAcknowledged(false);
                                }}
                              >
                                <Star className="h-3.5 w-3.5" /> Activar
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => {
                                setRenameId(y.id);
                                setRenameValue(y.name);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            {!isActive && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      ¿Eliminar el curso «{y.name}»?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      El curso desaparecerá de la lista oficial.
                                      Los datos asociados a ese curso (grupos,
                                      asignaciones, oferta) no se borran, pero el
                                      curso dejará de ofrecerse para selección.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>
                                      Cancelar
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => void onDelete(y.id, y.name)}
                                    >
                                      Eliminar
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TransitionCard years={years.map((y) => y.name)} activeYear={activeYear} />

      <OpenConfirmationCard
        years={years.map((y) => y.name)}
        activeYear={activeYear}
      />

      {/* Rename dialog */}
      <AlertDialog
        open={renameId != null}
        onOpenChange={(o) => {
          if (!o) {
            setRenameId(null);
            setRenameValue("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Renombrar curso</AlertDialogTitle>
            <AlertDialogDescription>
              El nuevo nombre se aplicará a todos los grupos, asignaciones y
              oferta formativa que usan este curso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-year">Nombre del curso</Label>
            <Input
              id="rename-year"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!renameValue.trim() || renameMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                void onRename();
              }}
            >
              Guardar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Set active double-confirm */}
      <AlertDialog
        open={activateTarget != null}
        onOpenChange={(o) => {
          if (!o) {
            setActivateTarget(null);
            setAcknowledged(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cambiar el curso activo
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  El curso activo determina qué grupos, asignaciones y oferta
                  formativa ve <strong>toda la plataforma</strong> de forma
                  predeterminada. Vas a activar{" "}
                  <strong>«{activateTarget}»</strong>.
                </p>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Entiendo que este cambio afecta a lo que ve toda la
                    plataforma y confirmo que quiero continuar.
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!acknowledged || setActiveMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (activateTarget) void onSetActive(activateTarget);
              }}
            >
              Sí, activar este curso
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --------------------------------------------------------------------------
function TransitionCard({
  years,
  activeYear,
}: {
  years: string[];
  activeYear: string | null;
}) {
  const qc = useQueryClient();
  const transitionMut = useTransitionAcademicYear();
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [copyGroups, setCopyGroups] = useState(true);
  const [copyTrainingOffer, setCopyTrainingOffer] = useState(true);
  const [copyAssignments, setCopyAssignments] = useState(false);

  useEffect(() => {
    if (!fromYear && activeYear) setFromYear(activeYear);
  }, [activeYear, fromYear]);

  const onRun = async () => {
    if (!fromYear || !toYear || fromYear === toYear) return;
    try {
      const res = await transitionMut.mutateAsync({
        data: { fromYear, toYear, copyGroups, copyTrainingOffer, copyAssignments },
      });
      await qc.invalidateQueries({ queryKey: getListAcademicYearsQueryKey() });
      toast({
        title: "Datos copiados al nuevo curso",
        description: `Grupos: ${res.groupsCopied} · Oferta: ${res.offerCopied} · Asignaciones: ${res.assignmentsCopied}`,
      });
    } catch {
      toast({
        title: "No se pudo completar la transición",
        description: "Comprueba los cursos de origen y destino.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Pasar de curso</CardTitle>
        </div>
        <CardDescription>
          Copia los datos de un curso al siguiente. La operación es idempotente:
          no duplica lo que ya exista en el curso de destino.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Curso de origen</Label>
            <Select value={fromYear} onValueChange={setFromYear}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                    {y === activeYear ? " (activo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Curso de destino</Label>
            <Select value={toYear} onValueChange={setToYear}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                    {y === activeYear ? " (activo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-sm">¿Qué quieres copiar?</Label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={copyGroups}
              onCheckedChange={(v) => setCopyGroups(v === true)}
            />
            Grupos
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={copyTrainingOffer}
              onCheckedChange={(v) => setCopyTrainingOffer(v === true)}
            />
            Oferta formativa
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={copyAssignments}
              onCheckedChange={(v) => setCopyAssignments(v === true)}
            />
            Asignaciones docentes
          </label>
        </div>
        {fromYear && toYear && fromYear === toYear && (
          <p className="text-sm font-medium text-destructive">
            El curso de origen y destino deben ser distintos.
          </p>
        )}
        <Button
          onClick={() => void onRun()}
          disabled={
            transitionMut.isPending ||
            !fromYear ||
            !toYear ||
            fromYear === toYear ||
            (!copyGroups && !copyTrainingOffer && !copyAssignments)
          }
          className="gap-2"
        >
          <ArrowRightLeft className="h-4 w-4" />
          {transitionMut.isPending ? "Copiando..." : "Copiar al curso destino"}
        </Button>
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------------
function OpenConfirmationCard({
  years,
  activeYear,
}: {
  years: string[];
  activeYear: string | null;
}) {
  const qc = useQueryClient();
  const openMut = useOpenYearConfirmation();
  const [year, setYear] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("15");

  useEffect(() => {
    if (!year && activeYear) setYear(activeYear);
  }, [activeYear, year]);

  const { data: confirmations = [] } = useListYearConfirmations(
    year ? { schoolYear: year } : undefined,
    {
      query: {
        queryKey: getListYearConfirmationsQueryKey(
          year ? { schoolYear: year } : undefined,
        ),
        enabled: !!year,
      },
    },
  );

  const onOpen = async () => {
    if (!year) return;
    const days = Number(deadlineDays) || 15;
    try {
      const res = await openMut.mutateAsync({
        data: { year, deadlineDays: days },
      });
      await qc.invalidateQueries({
        queryKey: getListYearConfirmationsQueryKey({ schoolYear: year }),
      });
      toast({
        title: "Ventana de confirmación abierta",
        description: res.emailPending
          ? `${res.created} profesores notificados en la app. Configura el correo para enviar recordatorios.`
          : `${res.created} confirmaciones creadas · ${res.emailed} correos enviados.`,
      });
    } catch {
      toast({
        title: "No se pudo abrir la confirmación",
        variant: "destructive",
      });
    }
  };

  const pending = confirmations.filter((c) => c.status === "pending").length;
  const confirmed = confirmations.filter((c) => c.status === "confirmed").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MailCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Confirmación anual del profesorado</CardTitle>
        </div>
        <CardDescription>
          Abre la ventana de confirmación obligatoria para un curso. Se crea una
          solicitud pendiente por profesor con plazo límite y se envía un
          recordatorio por correo (si está configurado).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Curso</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona" />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={y}>
                    {y}
                    {y === activeYear ? " (activo)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="deadline-days">Plazo (días)</Label>
            <Input
              id="deadline-days"
              type="number"
              min={1}
              value={deadlineDays}
              onChange={(e) => setDeadlineDays(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={() => void onOpen()}
          disabled={openMut.isPending || !year}
          className="gap-2"
        >
          <MailCheck className="h-4 w-4" />
          {openMut.isPending ? "Abriendo..." : "Abrir / reenviar confirmación"}
        </Button>

        {confirmations.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">Total: {confirmations.length}</Badge>
              <Badge variant="secondary">Confirmados: {confirmed}</Badge>
              <Badge variant="default">Pendientes: {pending}</Badge>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profesor</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Plazo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {confirmations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.teacherName ?? `#${c.teacherId}`}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.status === "confirmed" ? "secondary" : "outline"
                          }
                        >
                          {c.status === "confirmed" ? "Confirmado" : "Pendiente"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {c.deadline
                          ? new Date(c.deadline).toLocaleDateString("es-ES")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
