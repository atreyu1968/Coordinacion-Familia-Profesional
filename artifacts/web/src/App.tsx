import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { BrandingProvider } from "@/lib/branding";
import { AppLayout } from "@/components/layout";

const NotFound = lazy(() => import("@/pages/not-found"));
const LoginPage = lazy(() => import("@/pages/login"));
const RegisterPage = lazy(() => import("@/pages/register"));
const TermsPage = lazy(() => import("@/pages/legal").then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import("@/pages/legal").then((m) => ({ default: m.PrivacyPage })));
const CookiesPage = lazy(() => import("@/pages/legal").then((m) => ({ default: m.CookiesPage })));
const RecuperarPage = lazy(() => import("@/pages/recuperar"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const ConfiguracionPage = lazy(() => import("@/pages/configuracion"));
const UsuariosPage = lazy(() => import("@/pages/usuarios"));
const InvitacionesPage = lazy(() => import("@/pages/invitaciones"));
const CentrosPage = lazy(() => import("@/pages/centros"));
const CentroDetallePage = lazy(() => import("@/pages/centro-detalle"));
const AcademicaPage = lazy(() => import("@/pages/academica"));
const ModuloDetallePage = lazy(() => import("@/pages/modulo-detalle"));
const RecursosPage = lazy(() => import("@/pages/recursos"));
const FctPage = lazy(() => import("@/pages/fct"));
const EncuestasPage = lazy(() => import("@/pages/encuestas"));
const FormulariosPage = lazy(() => import("@/pages/formularios"));
const EventosPage = lazy(() => import("@/pages/eventos"));
const VideoconferenciasPage = lazy(() => import("@/pages/videoconferencias"));
const AnunciosPage = lazy(() => import("@/pages/anuncios"));
const ChatPage = lazy(() => import("@/pages/chat"));
const EspacioColaborativoPage = lazy(
  () => import("@/pages/espacio-colaborativo"),
);
const DocumentacionPage = lazy(() => import("@/pages/documentacion"));
const ForosPage = lazy(() => import("@/pages/foros"));
const SugerenciasPage = lazy(() => import("@/pages/sugerencias"));
const MemoriasPage = lazy(() => import("@/pages/memorias"));
const AsistenteIaPage = lazy(() => import("@/pages/asistente-ia"));
const AppMovilPage = lazy(() => import("@/pages/app-movil"));
const AutodirigidoPage = lazy(() => import("@/pages/autodirigido"));
const ScormPlayerPage = lazy(() =>
  import("@/pages/autodirigido").then((module) => ({
    default: module.ScormPlayerPage,
  })),
);

const queryClient = new QueryClient();

function RouteLoading() {
  return (
    <div role="status" className="p-8 text-center text-muted-foreground">
      Cargando...
    </div>
  );
}

function AuthedRoutes() {
  return (
    <AppLayout>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/usuarios" component={UsuariosPage} />
          <Route path="/invitaciones" component={InvitacionesPage} />
          <Route path="/centros" component={CentrosPage} />
          <Route path="/centros/:id" component={CentroDetallePage} />
          <Route path="/academica" component={AcademicaPage} />
          <Route path="/academica/modulo/:id" component={ModuloDetallePage} />
          <Route path="/recursos" component={RecursosPage} />
          <Route path="/fct" component={FctPage} />
          <Route path="/encuestas" component={EncuestasPage} />
          <Route path="/formularios" component={FormulariosPage} />
          <Route path="/eventos" component={EventosPage} />
          <Route path="/videoconferencias" component={VideoconferenciasPage} />
          <Route path="/anuncios" component={AnunciosPage} />
          <Route path="/chat" component={ChatPage} />
          <Route path="/espacio" component={EspacioColaborativoPage} />
          <Route path="/documentacion" component={DocumentacionPage} />
          <Route path="/foros" component={ForosPage} />
          <Route path="/sugerencias" component={SugerenciasPage} />
          <Route path="/memorias" component={MemoriasPage} />
          <Route path="/asistente-ia" component={AsistenteIaPage} />
          <Route path="/app-movil" component={AppMovilPage} />
          <Route path="/autodirigido" component={AutodirigidoPage} />
          <Route path="/panel-control" component={ConfiguracionPage} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </AppLayout>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/terminos" component={TermsPage} />
        <Route path="/privacidad" component={PrivacyPage} />
        <Route path="/cookies" component={CookiesPage} />
        <Route path="/recuperar" component={RecuperarPage} />
        <Route path="/scorm-player" component={ScormPlayerPage} />
        <Route component={AuthedRoutes} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrandingProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
        </BrandingProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
