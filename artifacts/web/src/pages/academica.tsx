import { useMemo, useState } from "react";
import {
  useListModules,
  useListGroups,
  useListTeachingAssignments,
  useListUsers,
  type ListModulesParams,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  GroupDialog,
  AssignmentDialog,
  TransferDialog,
} from "@/components/academic-dialogs";
import {
  EnrollButton,
  ModuleMembersDialog,
} from "@/components/module-members-dialog";
import {
  GraduationCap,
  Plus,
  Search,
  BookOpen,
  Users,
  ClipboardList,
  ArrowLeftRight,
  Crown,
} from "lucide-react";

export default function AcademicaPage() {
  const { user } = useAuth();
  const canManage =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head";

  const [moduleSearch, setModuleSearch] = useState("");

  const moduleParams: ListModulesParams = {};
  if (moduleSearch.trim()) moduleParams.search = moduleSearch.trim();

  const { data: modules = [], isLoading: modulesLoading } =
    useListModules(moduleParams);
  const { data: groups = [], isLoading: groupsLoading } = useListGroups({});
  const { data: assignments = [], isLoading: assignmentsLoading } =
    useListTeachingAssignments({});
  const { data: teachers = [], isLoading: teachersLoading } = useListUsers({
    role: "teacher",
  });

  const assignmentsByTeacher = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of assignments) {
      map.set(a.teacherId, (map.get(a.teacherId) ?? 0) + 1);
    }
    return map;
  }, [assignments]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Coordinación Académica
          </h1>
          <p className="text-sm text-muted-foreground">
            Plantilla docente, módulos, grupos y movilidad del profesorado.
          </p>
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
          <TabsTrigger value="grupos" className="gap-2">
            <GraduationCap className="w-4 h-4" /> Grupos
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
                    <TableHead className="text-right">Módulos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teachersLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  ) : teachers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No hay profesorado registrado.
                      </TableCell>
                    </TableRow>
                  ) : (
                    teachers.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell className="font-medium">{t.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {t.email}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary">
                            {assignmentsByTeacher.get(t.id) ?? 0}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
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
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Ciclo</TableHead>
                    <TableHead>Ámbito</TableHead>
                    <TableHead>Coordinador</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modulesLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  ) : modules.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No hay módulos.
                      </TableCell>
                    </TableRow>
                  ) : (
                    modules.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-sm">
                          {m.code ?? "—"}
                        </TableCell>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {m.name}
                            {m.myRole === "coordinator" && (
                              <Badge className="gap-1">
                                <Crown className="w-3 h-3" /> Coordino
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-normal">
                            {m.memberCount ?? 0}{" "}
                            {m.memberCount === 1 ? "miembro" : "miembros"}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.cycleName ?? "—"}
                        </TableCell>
                        <TableCell>
                          {m.centerId == null ? (
                            <Badge variant="outline">Global</Badge>
                          ) : (
                            <Badge variant="secondary">Centro</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.coordinatorName ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <EnrollButton module={m} />
                            {(canManage || m.myRole === "coordinator") && (
                              <ModuleMembersDialog
                                module={m}
                                canDesignateCoordinator={canManage}
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                  >
                                    <Users className="w-3.5 h-3.5" /> Miembros
                                  </Button>
                                }
                              />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Grupos */}
        <TabsContent value="grupos" className="space-y-4">
          <div className="flex items-center justify-end">
            {canManage && (
              <GroupDialog
                trigger={
                  <Button className="gap-2">
                    <Plus className="w-4 h-4" /> Nuevo grupo
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
                    <TableHead>Grupo</TableHead>
                    <TableHead>Ciclo</TableHead>
                    <TableHead>Curso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupsLoading ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center py-8">
                        Cargando...
                      </TableCell>
                    </TableRow>
                  ) : groups.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No hay grupos.
                      </TableCell>
                    </TableRow>
                  ) : (
                    groups.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell className="font-medium">{g.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {g.cycleName ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {g.schoolYear ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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
