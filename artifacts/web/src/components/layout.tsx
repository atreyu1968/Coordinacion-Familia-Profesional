import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Mail,
  Building2,
  Settings,
  LogOut,
  GraduationCap,
  Briefcase,
  BarChart,
  Calendar,
  Video,
  Megaphone,
  FileSignature,
  FileText,
  ClipboardList,
  FolderOpen,
  FolderKanban,
  BookText,
  Sparkles,
  Smartphone,
  MessageSquarePlus,
  MessagesSquare,
  MessageCircle,
  Pin,
  PinOff,
} from "lucide-react";
import { Button } from "./ui/button";
import { ProfileDialog } from "./profile-dialog";
import { TeacherConfirmationBanner } from "./teacher-confirmation-banner";
import logoWhite from "@/assets/logo-white.png";
import asdLogo from "@/assets/asd-logo.png";

const APP_VERSION = "3.4";

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_PINNED_KEY = "coordina_adg_sidebar_pinned";

export function AppLayout({ children }: LayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const { customLogoUrl, appName } = useBranding();
  const [location, setLocation] = useLocation();
  // The sidebar is collapsed (icons only) by default and expands on hover. The
  // pin (chincheta) at its foot keeps it open; that choice is persisted.
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_PINNED_KEY) === "1";
  });
  const [hovered, setHovered] = useState(false);
  const expanded = pinned || hovered;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_PINNED_KEY, pinned ? "1" : "0");
    }
  }, [pinned]);

  useEffect(() => {
    if (!isLoading && !user && location !== "/login" && !location.startsWith("/register")) {
      setLocation("/login");
    }
  }, [user, isLoading, location, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;
  }

  if (!user) {
    return <>{children}</>;
  }

  const role = user.role;

  const navItems = [
    { label: "Panel Principal", path: "/", icon: LayoutDashboard, visible: true },
    { label: "Usuarios", path: "/usuarios", icon: Users, visible: true },
    { label: "Invitaciones", path: "/invitaciones", icon: Mail, visible: ["coordinator", "department_head"].includes(role) },
    { label: "Centros", path: "/centros", icon: Building2, visible: role !== "superadmin" },
    { label: "Coord. Académica", path: "/academica", icon: GraduationCap, visible: true },
    { label: "FCT y Prospección", path: "/fct", icon: Briefcase, visible: false },
    { label: "Eventos", path: "/eventos", icon: Calendar, visible: true },
    { label: "Videoconferencias", path: "/videoconferencias", icon: Video, visible: true },
    { label: "Anuncios", path: "/anuncios", icon: Megaphone, visible: true },
    { label: "Mensajes", path: "/chat", icon: MessageCircle, visible: true },
    { label: "Espacio colaborativo", path: "/espacio", icon: FolderKanban, visible: true },
    { label: "Documentación", path: "/documentacion", icon: BookText, visible: true },
    { label: "Foros", path: "/foros", icon: MessagesSquare, visible: true },
    { label: "Encuestas", path: "/encuestas", icon: BarChart, visible: true },
    { label: "Formularios", path: "/formularios", icon: ClipboardList, visible: true },
    { label: "Recursos", path: "/recursos", icon: FolderOpen, visible: true },
    { label: "Memorias", path: "/memorias", icon: FileText, visible: ["superadmin", "coordinator"].includes(role) },
    { label: "Asistente IA", path: "/asistente-ia", icon: Sparkles, visible: role === "superadmin" },
    { label: "Sugerencias", path: "/sugerencias", icon: MessageSquarePlus, visible: true },
    { label: "App Móvil", path: "/app-movil", icon: Smartphone, visible: true },
    { label: "Configuración", path: "/panel-control", icon: Settings, visible: role === "superadmin" },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Top bar: spans full width above the sidebar, fixed height */}
      <header className="h-14 flex items-center justify-between gap-4 px-3 md:px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shrink-0">
        <div className="flex items-center gap-2">
          <img
            src={customLogoUrl ?? logoWhite}
            alt={appName}
            className="h-8 w-auto"
          />
        </div>

        <div className="flex items-center gap-3">
          <ProfileDialog user={user}>
            <button
              type="button"
              title="Editar perfil"
              aria-label="Editar perfil"
              className="flex items-center gap-3 rounded-md p-1 -m-1 hover:bg-sidebar-accent transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden hidden sm:block text-right">
                <div className="text-sm font-medium truncate">{user.name}</div>
                <div className="text-xs text-sidebar-foreground/60 capitalize">{user.role.replace("_", " ")}</div>
              </div>
            </button>
          </ProfileDialog>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 bg-transparent text-sidebar-foreground hover:bg-sidebar-accent border-sidebar-border"
            onClick={logout}
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Cerrar Sesión</span>
          </Button>
        </div>
      </header>

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 min-h-0 w-full">
        {/* Sidebar: a fixed-width rail reserves space; the panel inside expands
            on hover (overlaying the content) unless pinned open. */}
        <div className={`relative ${pinned ? "w-64" : "w-16"} hidden md:block shrink-0 transition-[width] duration-200 ease-in-out`}>
          <aside
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={`absolute inset-y-0 left-0 ${
              expanded ? "w-64" : "w-16"
            } bg-sidebar border-r border-sidebar-border flex flex-col text-sidebar-foreground transition-[width] duration-200 ease-in-out z-30 ${
              hovered && !pinned ? "shadow-xl" : ""
            }`}
          >
            <nav className="flex-1 py-3 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2">
              {navItems.filter((i) => i.visible).map((item) => {
                const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    title={item.label}
                    aria-label={item.label}
                    className={`flex items-center gap-3 rounded-md transition-colors text-sm font-medium ${
                      expanded ? "px-3 py-2" : "justify-center px-0 py-2.5"
                    } ${
                      isActive
                        ? "bg-sidebar-primary text-sidebar-primary-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <item.icon className="w-4 h-4 shrink-0" />
                    {expanded ? (
                      <span className="truncate">{item.label}</span>
                    ) : (
                      <span className="sr-only">{item.label}</span>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Pin (chincheta): keeps the sidebar open. */}
            <div className="border-t border-sidebar-border p-2">
              <button
                type="button"
                onClick={() => setPinned((p) => !p)}
                aria-pressed={pinned}
                title={pinned ? "Desfijar menú" : "Fijar menú abierto"}
                aria-label={pinned ? "Desfijar menú" : "Fijar menú abierto"}
                className={`flex items-center gap-3 w-full rounded-md transition-colors text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                  expanded ? "px-3 py-2" : "justify-center px-0 py-2.5"
                }`}
              >
                {pinned ? (
                  <PinOff className="w-4 h-4 shrink-0" />
                ) : (
                  <Pin className="w-4 h-4 shrink-0" />
                )}
                {expanded ? (
                  <span className="truncate">{pinned ? "Desfijar menú" : "Fijar menú"}</span>
                ) : (
                  <span className="sr-only">{pinned ? "Desfijar menú" : "Fijar menú"}</span>
                )}
              </button>
            </div>
          </aside>
        </div>

        {/* Main content (footer lives here so the sidebar spans full height and
            covers the footer strip on the left). */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-6 md:p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto w-full">
              <TeacherConfirmationBanner />
              {children}
            </div>
          </div>

          {/* Compact footer */}
          <footer className="shrink-0 h-8 border-t border-border bg-background px-4 flex items-center justify-center gap-1.5 text-[11px] leading-none text-muted-foreground">
            <span>Desarrollado por</span>
            <img src={asdLogo} alt="Atreyu Servicios Digitales" className="h-4 w-auto" />
            <span className="font-medium text-foreground/80">Atreyu Servicios Digitales</span>
            <span className="text-muted-foreground/50">·</span>
            <span>v{APP_VERSION}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
