import { useAuth } from "@/lib/auth";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
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
  FileText
} from "lucide-react";
import { Button } from "./ui/button";

interface LayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: LayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const [location, setLocation] = useLocation();

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
    
    // Upcoming modules
    { label: "Coord. Académica", path: "/academica", icon: GraduationCap, visible: true },
    { label: "FCT y Prospección", path: "/fct", icon: Briefcase, visible: true },
    { label: "Encuestas", path: "/encuestas", icon: BarChart, visible: true },
    { label: "Eventos", path: "/eventos", icon: Calendar, visible: true },
    { label: "Memorias", path: "/memorias", icon: FileText, visible: true },
    
    { label: "Panel de Control", path: "/panel-control", icon: Settings, visible: role === "superadmin" },
  ];

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Sidebar */}
      <div className="w-64 bg-sidebar border-r border-sidebar-border hidden md:flex flex-col text-sidebar-foreground">
        <div className="p-6">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-sidebar-primary">
            <div className="w-8 h-8 rounded-md bg-sidebar-primary flex items-center justify-center text-primary-foreground">
              ADG
            </div>
            Coordina ADG
          </div>
        </div>
        
        <div className="flex-1 py-4 flex flex-col gap-1 overflow-y-auto px-4">
          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2">Menu</div>
          {navItems.filter(i => i.visible).map((item) => {
            const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground" 
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-sidebar-border bg-sidebar/50">
          <div className="flex items-center gap-3 px-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-xs text-sidebar-foreground/60 capitalize">{user.role.replace("_", " ")}</div>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start gap-2 bg-transparent text-sidebar-foreground hover:bg-sidebar-accent border-sidebar-border" onClick={logout}>
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </Button>
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header (simplified for brevity) */}
        <header className="md:hidden flex items-center h-16 px-4 border-b bg-card">
          <div className="font-bold text-lg text-primary">Coordina ADG</div>
        </header>
        
        <div className="flex-1 p-6 md:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
