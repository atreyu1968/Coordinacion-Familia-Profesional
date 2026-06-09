import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Mail,
  Building2,
  Network,
  Settings,
  LogOut,
  GraduationCap,
  Briefcase,
  BarChart,
  Calendar,
  FileText,
  ClipboardList,
  FolderOpen,
  Sparkles,
  Smartphone,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { Button } from "./ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_STORAGE_KEY = "coordina_adg_sidebar_collapsed";

export function AppLayout({ children }: LayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
    }
  }, [collapsed]);

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
    { label: "Invitaciones", path: "/invitaciones", icon: Mail, visible: ["superadmin", "coordinator", "department_head"].includes(role) },
    { label: "Centros", path: "/centros", icon: Building2, visible: true },
    { label: "Departamentos", path: "/departamentos", icon: Network, visible: true },
    { label: "Coord. Académica", path: "/academica", icon: GraduationCap, visible: true },
    { label: "FCT y Prospección", path: "/fct", icon: Briefcase, visible: true },
    { label: "Eventos", path: "/eventos", icon: Calendar, visible: true },
    { label: "Encuestas", path: "/encuestas", icon: BarChart, visible: true },
    { label: "Formularios", path: "/formularios", icon: ClipboardList, visible: ["superadmin", "coordinator"].includes(role) },
    { label: "Recursos", path: "/recursos", icon: FolderOpen, visible: true },
    { label: "Memorias", path: "/memorias", icon: FileText, visible: true },
    { label: "Asistente IA", path: "/asistente-ia", icon: Sparkles, visible: true },
    { label: "App Móvil", path: "/app-movil", icon: Smartphone, visible: true },
    { label: "Panel de Control", path: "/panel-control", icon: Settings, visible: role === "superadmin" },
  ];

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Top bar: spans full width above the sidebar, fixed height */}
      <header className="h-14 flex items-center justify-between gap-4 px-3 md:px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shrink-0">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-sidebar-foreground hover:bg-sidebar-accent hidden md:inline-flex"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expandir menú" : "Contraer menú"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expandir menú" : "Contraer menú"}
          >
            {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </Button>
          <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-sidebar-primary">
            <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center text-primary-foreground text-sm">
              ADG
            </div>
            <span className="hidden sm:inline">Coordina ADG</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden hidden sm:block text-right">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-xs text-sidebar-foreground/60 capitalize">{user.role.replace("_", " ")}</div>
            </div>
          </div>
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
        {/* Sidebar */}
        <div
          className={`${
            collapsed ? "w-16" : "w-64"
          } bg-sidebar border-r border-sidebar-border hidden md:flex flex-col text-sidebar-foreground transition-[width] duration-200 ease-in-out shrink-0`}
        >
          <nav className="flex-1 py-3 flex flex-col gap-0.5 overflow-y-auto px-2">
            {navItems.filter((i) => i.visible).map((item) => {
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  title={item.label}
                  aria-label={item.label}
                  className={`flex items-center gap-3 rounded-md transition-colors text-sm font-medium ${
                    collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2"
                  } ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {collapsed ? (
                    <span className="sr-only">{item.label}</span>
                  ) : (
                    <span className="truncate">{item.label}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Main content */}
        <main className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 p-6 md:p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto w-full">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
