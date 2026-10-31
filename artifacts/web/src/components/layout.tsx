import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import {
  getGetMyTeachingProfileQueryKey,
  useGetMyTeachingProfile,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  LogOut,
  Pin,
  PinOff,
  Menu,
  X,
  LoaderCircle,
} from "lucide-react";
import { Button } from "./ui/button";
import { ProfileDialog } from "./profile-dialog";
import { getTeachingProfileGateState } from "./teaching-profile-gate";
import { TeacherConfirmationBanner } from "./teacher-confirmation-banner";
import { AppNotifications } from "./collab/space-notifications";
import { PrimaryNavigation } from "./navigation/primary-navigation";
import logoWhite from "@/assets/logo-white.png";
import asdLogo from "@/assets/asd-logo.png";

const APP_VERSION = "4.0";

interface LayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_PINNED_KEY = "coordina_adg_sidebar_pinned";

export function AppLayout({ children }: LayoutProps) {
  const { user, isLoading, logout } = useAuth();
  const { customLogoUrl, appName } = useBranding();
  const [location, setLocation] = useLocation();
  const isTeacher = ["teacher", "department_head", "coordinator", "superadmin"].includes(user?.role ?? "");
  const personalCenterId = user?.role === "teacher" ? user.centerId : user?.teachingCenterId ?? user?.centerId;
  const teachingProfileQuery = useGetMyTeachingProfile(
    { targetCenterId: personalCenterId ?? undefined },
    {
      query: {
        queryKey: getGetMyTeachingProfileQueryKey({
          targetCenterId: personalCenterId ?? undefined,
        }),
        enabled: isTeacher,
        retry: false,
        retryOnMount: false,
        refetchOnMount: false,
      },
    },
  );
  const teachingProfile = teachingProfileQuery.data;
  const profileGate = getTeachingProfileGateState({
    isTeacher,
    isPending: teachingProfileQuery.isPending,
    isError: teachingProfileQuery.isError,
    profile: teachingProfile,
  });
  const profileCheckPending = profileGate.checking;
  const profileCheckFailed = profileGate.failed;
  const forceTeachingProfileCompletion = profileGate.requiresCompletion;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // The sidebar is collapsed (icons only) by default and expands on hover. The
  // pin (chincheta) at its foot keeps it open; that choice is persisted.
  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_PINNED_KEY) === "1";
  });
  const [hovered, setHovered] = useState(false);
  const [sidebarFocused, setSidebarFocused] = useState(false);
  const expanded = pinned || hovered || sidebarFocused;

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

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Cargando...</div>;
  }

  if (!user) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Redirigiendo al acceso...</div>;
  }

  if (location.startsWith("/aula/")) {
    return (
      <div className="relative h-[100dvh] w-full overflow-y-auto bg-background">
        {children}
        {forceTeachingProfileCompletion && (
          <ProfileDialog user={user} forceOpen>
            <button type="button" className="hidden" aria-hidden="true" tabIndex={-1} />
          </ProfileDialog>
        )}
        {profileCheckPending && (
          <div role="status" aria-live="polite" className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background px-6 text-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Comprobando tu perfil docente…</p>
          </div>
        )}
        {profileCheckFailed && (
          <div role="alert" className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">No se pudo comprobar tu perfil docente</h2>
              <p className="max-w-md text-sm text-muted-foreground">Por seguridad, es necesario completar esta comprobación antes de continuar.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => void teachingProfileQuery.refetch()} disabled={teachingProfileQuery.isFetching}>
                {teachingProfileQuery.isFetching ? "Comprobando…" : "Reintentar"}
              </Button>
              <Button type="button" variant="outline" onClick={logout}>Cerrar sesión</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  const role = user.role;

  return (
    <div className="relative flex flex-col h-screen w-full bg-background overflow-hidden">
      {/* Top bar: spans full width above the sidebar, fixed height */}
      <header className="h-14 flex items-center justify-between gap-4 px-3 md:px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground shrink-0">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="md:hidden text-sidebar-foreground hover:bg-sidebar-accent"
            aria-label={mobileMenuOpen ? "Cerrar menú de navegación" : "Abrir menú de navegación"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-primary-navigation"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <img
            src={customLogoUrl ?? logoWhite}
            alt={appName}
            className="h-8 w-auto"
          />
        </div>

        <div className="flex items-center gap-3">
          <AppNotifications userId={user.id} role={role} />
          <ProfileDialog
            user={user}
            forceOpen={forceTeachingProfileCompletion}
          >
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

      {mobileMenuOpen && (
        <nav
          id="mobile-primary-navigation"
          aria-label="Navegación principal"
          className="absolute inset-x-0 top-14 bottom-8 z-40 overflow-y-auto border-b border-border bg-background p-3 shadow-xl md:hidden"
        >
          <PrimaryNavigation role={role} location={location} mobile onNavigate={() => setMobileMenuOpen(false)} />
        </nav>
      )}

      {/* Body: sidebar + main content */}
      <div className="flex flex-1 min-h-0 w-full">
        {/* Sidebar: a fixed-width rail reserves space; the panel inside expands
            on hover (overlaying the content) unless pinned open. */}
        <div className={`relative ${pinned ? "w-64" : "w-16"} hidden md:block shrink-0 transition-[width] duration-200 ease-in-out`}>
          <aside
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPointerDownCapture={() => setSidebarFocused(false)}
            onFocusCapture={(event) => {
              if ((event.target as HTMLElement).matches(":focus-visible")) setSidebarFocused(true);
            }}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSidebarFocused(false);
            }}
            className={`absolute inset-y-0 left-0 ${
              expanded ? "w-64" : "w-16"
            } bg-sidebar border-r border-sidebar-border flex flex-col text-sidebar-foreground transition-[width] duration-200 ease-in-out z-30 ${
              expanded && !pinned ? "shadow-xl" : ""
            }`}
          >
            <nav aria-label="Navegación principal" className="flex-1 min-h-0 py-3 overflow-y-auto overflow-x-hidden px-2">
              <PrimaryNavigation role={role} location={location} expanded={expanded} />
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
          <footer className="shrink-0 min-h-8 border-t border-border bg-background px-4 py-2 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[11px] leading-none text-muted-foreground">
            <span>Desarrollado por</span>
            <img src={asdLogo} alt="Atreyu Servicios Digitales" className="h-4 w-auto" />
            <span className="font-medium text-foreground/80">Atreyu Servicios Digitales</span>
            <span className="text-muted-foreground/50">·</span>
            <span>v{APP_VERSION}</span>
            <span className="text-muted-foreground/50">·</span>
            <Link href="/terminos" className="hover:underline">Términos</Link>
            <Link href="/privacidad" className="hover:underline">Privacidad</Link>
            <Link href="/cookies" className="hover:underline">Cookies</Link>
          </footer>
        </main>
      </div>
      {profileCheckPending && (
        <div
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background px-6 text-center"
          role="status"
          aria-live="polite"
        >
          <LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            Comprobando tu perfil docente…
          </p>
        </div>
      )}
      {profileCheckFailed && (
        <div
          className="absolute inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center"
          role="alert"
        >
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">
              No se pudo comprobar tu perfil docente
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Por seguridad, es necesario completar esta comprobación antes de
              continuar.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              onClick={() => void teachingProfileQuery.refetch()}
              disabled={teachingProfileQuery.isFetching}
            >
              {teachingProfileQuery.isFetching ? "Comprobando…" : "Reintentar"}
            </Button>
            <Button type="button" variant="outline" onClick={logout}>
              Cerrar sesión
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
