import { Link, useRoute } from "wouter";
import { useListModules } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  EnrollButton,
  ModuleMembersDialog,
} from "@/components/module-members-dialog";
import { ModuleOutcomes } from "@/components/module-outcomes";
import {
  ArrowLeft,
  BookOpen,
  BookText,
  ClipboardList,
  Crown,
  FolderKanban,
  GraduationCap,
  MessageCircle,
  MessagesSquare,
  Users,
  Video,
} from "lucide-react";

type Tool = {
  label: string;
  description: string;
  href: string;
  icon: typeof MessageCircle;
  accent: string;
};

export default function ModuloDetallePage() {
  const [, params] = useRoute("/academica/modulo/:id");
  const { user } = useAuth();
  const moduleId = params?.id ? Number(params.id) : null;

  const { data: modules = [], isLoading } = useListModules({});
  const module = modules.find((m) => m.id === moduleId);

  const canManage =
    user?.role === "superadmin" ||
    user?.role === "coordinator" ||
    user?.role === "department_head";

  if (isLoading) {
    return (
      <div className="py-12 text-center text-muted-foreground">Cargando…</div>
    );
  }

  if (!module) {
    return (
      <div className="space-y-4">
        <Link
          href="/academica"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Volver a Coordinación Académica
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No se ha encontrado el módulo solicitado.
          </CardContent>
        </Card>
      </div>
    );
  }

  const q = `?module=${module.id}`;
  const tools: Tool[] = [
    {
      label: "Chat del módulo",
      description: "Conversación del equipo docente del módulo.",
      href: `/chat${q}`,
      icon: MessageCircle,
      accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    },
    {
      label: "Videoconferencias",
      description: "Salas de videollamada dedicadas al módulo.",
      href: `/videoconferencias${q}`,
      icon: Video,
      accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    },
    {
      label: "Foros",
      description: "Hilos de debate y consultas del módulo.",
      href: `/foros${q}`,
      icon: MessagesSquare,
      accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    },
    {
      label: "Área colaborativa",
      description: "Espacio de archivos compartidos del módulo.",
      href: `/espacio${q}`,
      icon: FolderKanban,
      accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Documentación",
      description: "Wiki colaborativa del módulo. Todos leen; editan los autorizados.",
      href: `/documentacion${q}`,
      icon: BookText,
      accent: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    },
    {
      label: "Recursos",
      description: "Materiales y documentación del módulo.",
      href: `/recursos${q}`,
      icon: BookOpen,
      accent: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
    },
    {
      label: "Formularios",
      description: "Formularios de recogida dirigidos al módulo.",
      href: `/formularios${q}`,
      icon: ClipboardList,
      accent: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/academica"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> Volver a Coordinación Académica
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">
                {module.name}
              </h1>
              {module.code && (
                <Badge variant="secondary" className="font-mono">
                  {module.code}
                </Badge>
              )}
              {module.myRole === "coordinator" && (
                <Badge className="gap-1">
                  <Crown className="w-3 h-3" /> Coordino
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <GraduationCap className="w-4 h-4" />
              {module.cycleName ?? "Sin ciclo"}
              <span className="text-muted-foreground/50">·</span>
              {module.memberCount ?? 0}{" "}
              {module.memberCount === 1 ? "miembro" : "miembros"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <EnrollButton module={module} />
          {(canManage || module.myRole === "coordinator") && (
            <ModuleMembersDialog
              module={module}
              canDesignateCoordinator={canManage}
              trigger={
                <Button variant="outline" className="gap-1.5">
                  <Users className="w-4 h-4" /> Miembros
                </Button>
              }
            />
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3">
          Herramientas del módulo
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t) => {
            const Icon = t.icon;
            return (
              <Link key={t.label} href={t.href}>
                <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/40 cursor-pointer">
                  <CardContent className="p-4 flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${t.accent}`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{t.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {t.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resultados de aprendizaje</CardTitle>
        </CardHeader>
        <CardContent>
          <ModuleOutcomes moduleId={module.id} />
        </CardContent>
      </Card>
    </div>
  );
}
