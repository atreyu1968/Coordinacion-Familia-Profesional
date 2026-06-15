import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { BrandingProvider } from "@/lib/branding";
import { AppLayout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import RecuperarPage from "@/pages/recuperar";
import DashboardPage from "@/pages/dashboard";
import ConfiguracionPage from "@/pages/configuracion";
import UsuariosPage from "@/pages/usuarios";
import InvitacionesPage from "@/pages/invitaciones";
import CentrosPage from "@/pages/centros";
import CentroDetallePage from "@/pages/centro-detalle";
import AcademicaPage from "@/pages/academica";
import RecursosPage from "@/pages/recursos";
import FctPage from "@/pages/fct";
import EncuestasPage from "@/pages/encuestas";
import FormulariosPage from "@/pages/formularios";
import EventosPage from "@/pages/eventos";
import VideoconferenciasPage from "@/pages/videoconferencias";
import AnunciosPage from "@/pages/anuncios";
import ChatPage from "@/pages/chat";
import EspacioColaborativoPage from "@/pages/espacio-colaborativo";
import ForosPage from "@/pages/foros";
import SugerenciasPage from "@/pages/sugerencias";
import MemoriasPage from "@/pages/memorias";
import AsistenteIaPage from "@/pages/asistente-ia";
import AppMovilPage from "@/pages/app-movil";

const queryClient = new QueryClient();

function AuthedRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/usuarios" component={UsuariosPage} />
        <Route path="/invitaciones" component={InvitacionesPage} />
        <Route path="/centros" component={CentrosPage} />
        <Route path="/centros/:id" component={CentroDetallePage} />
        <Route path="/academica" component={AcademicaPage} />
        <Route path="/recursos" component={RecursosPage} />
        <Route path="/fct" component={FctPage} />
        <Route path="/encuestas" component={EncuestasPage} />
        <Route path="/formularios" component={FormulariosPage} />
        <Route path="/eventos" component={EventosPage} />
        <Route path="/videoconferencias" component={VideoconferenciasPage} />
        <Route path="/anuncios" component={AnunciosPage} />
        <Route path="/chat" component={ChatPage} />
        <Route path="/espacio" component={EspacioColaborativoPage} />
        <Route path="/foros" component={ForosPage} />
        <Route path="/sugerencias" component={SugerenciasPage} />
        <Route path="/memorias" component={MemoriasPage} />
        <Route path="/asistente-ia" component={AsistenteIaPage} />
        <Route path="/app-movil" component={AppMovilPage} />
        <Route path="/panel-control" component={ConfiguracionPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/recuperar" component={RecuperarPage} />
      <Route component={AuthedRoutes} />
    </Switch>
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
