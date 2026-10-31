import {
  LayoutDashboard, Users, MailPlus, Inbox, AtSign, Building2, Settings,
  GraduationCap, BarChart, Calendar, BookCheck, Video, Megaphone, FileText,
  ClipboardList, FolderOpen, FolderKanban, BookText, Sparkles, Smartphone,
  BookOpen, MessageSquarePlus, MessagesSquare, MessageCircle, Award,
  CheckSquare, Network, Radio, Workflow, LibraryBig, ShieldCheck, ContactRound,
  type LucideIcon,
} from "lucide-react";

export interface NavigationItem {
  label: string;
  path: string;
  icon: LucideIcon;
  visible?: boolean;
}
export interface NavigationGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavigationItem[];
}
export const DASHBOARD_ITEM: NavigationItem = { label: "Panel principal", path: "/", icon: LayoutDashboard };
export const CORPORATE_EMAIL_URL =
  "https://www3.gobiernodecanarias.org/sso/login?service=https%3A%2F%2Fecorreo.gobiernodecanarias.org%2Fpublic%2Fpreauth.jsp";

/** Presentation only: keep the existing role visibility, routes and external
 * targets. Backend authorization remains unchanged. Omit empty groups. */
export function getNavigationGroups(role: string): NavigationGroup[] {
  const manages = ["superadmin", "coordinator"].includes(role);
  const invites = manages || role === "department_head";
  return [
    {
      id: "network", label: "Red y docencia", icon: Network,
      items: [
        { label: "Usuarios", path: "/usuarios", icon: Users },
        { label: "Centros", path: "/centros", icon: Building2, visible: role !== "superadmin" },
        { label: "Coordinación académica", path: "/academica", icon: GraduationCap },
      ],
    },
    {
      id: "communication", label: "Comunicación", icon: Radio,
      items: [
        { label: "Mensajes", path: "/chat", icon: MessageCircle },
        { label: "Anuncios", path: "/anuncios", icon: Megaphone },
        { label: "Foros", path: "/foros", icon: MessagesSquare },
        { label: "Videoconferencias", path: "/videoconferencias", icon: Video },
        { label: "Correo corporativo", path: CORPORATE_EMAIL_URL, icon: AtSign },
        { label: "Asuntos de correo", path: "/asuntos-correo", icon: Inbox, visible: manages },
      ],
    },
    {
      id: "coordination", label: "Coordinación", icon: Workflow,
      items: [
        { label: "Eventos", path: "/eventos", icon: Calendar },
        { label: "Actas publicadas", path: "/actas", icon: BookCheck, visible: role === "department_head" },
        { label: "Tareas pendientes", path: "/tareas-pendientes", icon: CheckSquare, visible: manages },
        { label: "Encuestas", path: "/encuestas", icon: BarChart },
        { label: "Formularios", path: "/formularios", icon: ClipboardList },
        { label: "Memorias", path: "/memorias", icon: FileText, visible: manages },
      ],
    },
    {
      id: "materials", label: "Documentación y cursos", icon: LibraryBig,
      items: [
        { label: "Documentación", path: "/documentacion", icon: BookText },
        { label: "Recursos", path: "/recursos", icon: FolderOpen },
        { label: "Espacio colaborativo", path: "/espacio", icon: FolderKanban },
        { label: "Cursos autodirigidos", path: "/autodirigido", icon: BookOpen },
      ],
    },
    {
      id: "administration", label: "Administración", icon: ShieldCheck,
      items: [
        { label: "Invitaciones", path: "/invitaciones", icon: MailPlus, visible: invites },
        { label: "Asistente IA", path: "/asistente-ia", icon: Sparkles, visible: role === "superadmin" },
        { label: "Configuración", path: "/panel-control", icon: Settings, visible: role === "superadmin" },
      ],
    },
    {
      id: "personal", label: "Mi espacio", icon: ContactRound,
      items: [
        { label: "Mis certificados", path: "/mis-certificados", icon: Award },
        { label: "Sugerencias", path: "/sugerencias", icon: MessageSquarePlus },
        { label: "App móvil", path: "/app-movil", icon: Smartphone },
      ],
    },
  ].map(group => ({ ...group, items: group.items.filter(item => item.visible !== false) }))
    .filter(group => group.items.length > 0);
}

export function navigationItemIsActive(location: string, path: string): boolean {
  if (path.startsWith("https://")) return false;
  const current = location.split(/[?#]/)[0];
  return current === path || (path !== "/" && current.startsWith(`${path}/`));
}
