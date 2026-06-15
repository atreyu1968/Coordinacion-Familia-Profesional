import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListModules,
  useListTeachingAssignments,
  useListUsers,
  useListYearConfirmations,
  getListYearConfirmationsQueryKey,
  type ListModulesParams,
  type Module,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmailLink } from "@/components/contact-link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ModuleDialog,
  AssignmentDialog,
  TransferDialog,
} from "@/components/academic-dialogs";
import {
  EnrollButton,
  ModuleMembersDialog,
} from "@/components/module-members-dialog";
import {
  YearFilter,
  ALL_YEARS,
  useAcademicYears,
} from "@/components/year-selector";
import {
  GraduationCap,
  Plus,
  Search,
  BookOpen,
  Users,
  ClipboardList,
  ArrowLeftRight,
  Crown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

function ModuleNavRow({
  module: m,
  canManage,
}: {
  module: Module;
  canManage: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 p-3">
      <Link
        href={`/academica/modulo/${m.id}`}
        className="flex items-center gap-3 min-w-0 flex-1 hover:text-foreground/80"
      >
        <BookOpen className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{m.name}</span>
            {m.code && (
              <Badge variant="secondary" className="font-mono shrink-0">
                {m.code}
              </Badge>
            )}
            {m.myRole === "coordinator" && (
              <Badge className="gap-1 shrink-0">
                <Crown className="w-3 h-3" /> Coordino
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {m.memberCount ?? 0} {m.memberCount === 1 ? "miembro" : "miembros"}
            {m.coordinatorName ? ` · ${m.coordinatorName}` : ""}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2 shrink-0">
        <EnrollButton module={m} />
        {(canManage || m.myRole === "coordinator") && (
          <ModuleMembersDialog
            module={m}
            canDesignateCoordinator={canManage}
            trigger={
              <Button size="sm" variant="outline" className="gap-1.5">
                <Users className="w-3.5 h-3.5" /> Miembros
              </Button>
            }
          />
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </div>
    </div>
  );
}

function CycleGroup({
  cycleName,
  modules,
  canManage,
  defaultOpen,
}: {
  cycleName: string;
  modules: Module[];
  canManage: boolean;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 p-3 text-left"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 shrink-0" />
        )}
        <GraduationCap className="w-4 h-4 text-primary shrink-0" />
        <span className="font-medium truncate flex-1">{cycleName}</span>
        <Badge variant="secondary" className="shrink-0">
          {modules.length} {modules.length === 1 ? "módulo" : "módulos"}
        </Badge>
      </button>
      {open && (
        <div className="border-t divide-y">
          {modules.map((m) => (
            <ModuleNavRow key={m.id} module={m} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AcademicaPage() {
  const { user } = useAuth();
  const canManage =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head";

  const [moduleSearch, setModuleSearch] = useState("");
  const { activeYear } = useAcademicYears();
  const [year, setYear] = useState<string>("");

  useEffect(() => {
    if (!year && activeYear) setYear(activeYear);
  }, [activeYear, year]);

  const moduleParams: ListModulesParams = {};
  if (moduleSearch.trim()) moduleParams.search = moduleSearch.trim();

  const yearParam = !year ? undefined : year === ALL_YEARS ? "all" : year;
  const showConfirmation = canManage && !!year && year !== ALL_YEARS;

  const { data: modules = [], isLoading: modulesLoading } =
    useListModules(moduleParams);
  const { data: assignments = [], isLoading: assignmentsLoading } =
    useListTeachingAssignments(yearParam ? { schoolYear: yearParam } : {});
  const { data: teachers = [], isLoading: teachersLoading } = useListUsers({
    role: "teacher",
  });
  const confirmationParams = showConfirmation ? { schoolYear: year } : undefined;
  const { data: confirmations = [] } = useListYearConfirmations(
    confirmationParams,
    {
      query: {
        queryKey: getListYearConfirmationsQueryKey(confirmationParams),
        enabled: showConfirmation,
      },
    },
  );

  const confirmationByTeacher = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of confirmations) {
      map.set(c.teacherId, c.status);
    }
    return map;
  }, [confirmations]);

  const assignmentsByTeacher = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of assignments) {
      map.set(a.teacherId, (map.get(a.teacherId) ?? 0) + 1);
    }
    return map;
  }, [assignments]);

  const modulesByCycle = useMemo(() => {
    const map = new Map<string, Module[]>();
    for (const m of modules) {
      const key = m.cycleName ?? "Sin ciclo";
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === "Sin ciclo") return 1;
      if (b === "Sin ciclo") return -1;
      return a.localeCompare(b);
    });
  }, [modules]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Coordinación Académica
            </h1>
            <p className="text-sm text-muted-foreground">
              Plantilla docente, módulos por ciclo y movilidad del profesorado.
            </p>
          </div>
        </div>
        <div className="w-full sm:w-56">
          <YearFilter value={year} onChange={setYear} />
        </div>
      </div>

      <Tabs defaultValue="profesorado">
        <TabsList>
          <TabsTrigger value="profesorado" className="gap-2">
            <Users className="w-4 h-4" /> Profesorado
          </TabsTrigger>
          <TabsTrigger value="modulos" className="gap-2">
            <BookOpen className="w-4 h-4" /> Módulos
          </TabsTrigger>
          <TabsTrigger value="asignaciones" className="gap-2">
            <ClipboardList className="w-4 h-4" /> Asignaciones
          </TabsTrigger>
        </TabsList>

        {/* Profesorado */}
        <TabsContent value="profesorado" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Plantilla docente de tu ámbito.
            </p>
            {canManage && (
              <TransferDialog
                trigger={
                  <Button variant="outline" className="gap-2">
                    <ArrowLeftRight className="w-4 h-4" /> Movilidad docente
                  </Button>
                }
              />
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profesor</TableHead>
                    <TableHead>Correo</TableHead>
                    {showConfirmation && <TableHead>Confirmación</TableHead>}
                    <TableHead className="text-right">Módulos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teachersLoading ? (
                    <TableRow>
                      <TableCell colSpan={showConfirmation ? 4 : 3} className="text-center py-8">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  ) : teachers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={showConfirmation ? 4 : 3}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No hay profesorado registrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    teachers.map((t) => {
                      const confStatus = confirmationByTeacher.get(t.id);
                      return (
                        <TableRow key={t.id}>
                          <TableCell className="font-medium">{t.name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            <EmailLink email={t.email} />
                          </TableCell>
                          {showConfirmation && (
                            <TableCell>
                              {confStatus === "confirmed" ? (
                                <Badge variant="secondary">Confirmado</Badge>
                              ) : confStatus === "pending" ? (
                                <Badge variant="outline">Pendiente</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          )}
                          <TableCell className="text-right">
                            <Badge variant="secondary">
                              {assignmentsByTeacher.get(t.id) ?? 0}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Módulos */}
        <TabsContent value="modulos" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <div className="relative max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={moduleSearch}
                onChange={(e) => setModuleSearch(e.target.value)}
                placeholder="Buscar módulo..."
                className="pl-9"
              />
            </div>
            {user?.role === "superadmin" && (
              <ModuleDialog
                trigger={
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" /> Nuevo módulo
                  </Button>
                }
              />
            )}
          </div>
          {modulesLoading ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Cargando...
              </CardContent>
            </Card>
          ) : modules.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No hay módulos.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {modulesByCycle.map(([cycleName, cycleModules]) => (
                <CycleGroup
                  key={cycleName}
                  cycleName={cycleName}
                  modules={cycleModules}
                  canManage={canManage}
                  defaultOpen={modulesByCycle.length <= 3}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Asignaciones */}
        <TabsContent value="asignaciones" className="space-y-4">
          <div className="flex items-center justify-end">
            {canManage && (
              <AssignmentDialog
                trigger={
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" /> Nueva asignación
                  </Button>
                }
              />
            )}
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Profesor</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Curso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignmentsLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  ) : assignments.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No hay asignaciones.
                      </TableCell>
                    </TableRow>
                  ) : (
                    assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">
                          {a.teacherName ?? `#${a.teacherId}`}
                        </TableCell>
                        <TableCell>
                          {a.moduleName ?? `Módulo #${a.moduleId}`}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {a.schoolYear ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
