import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { AppLayout } from "@/components/layout";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import PanelControlPage from "@/pages/panel-control";
import CentrosPage from "@/pages/centros";
import CentroDetallePage from "@/pages/centro-detalle";
import AcademicaPage from "@/pages/academica";
import RecursosPage from "@/pages/recursos";
import FctPage from "@/pages/fct";
import EncuestasPage from "@/pages/encuestas";
import EventosPage from "@/pages/eventos";
import AsistenteIaPage from "@/pages/asistente-ia";

const queryClient = new QueryClient();

function AuthedRoutes() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/centros" component={CentrosPage} />
        <Route path="/centros/:id" component={CentroDetallePage} />
        <Route path="/academica" component={AcademicaPage} />
        <Route path="/recursos" component={RecursosPage} />
        <Route path="/fct" component={FctPage} />
        <Route path="/encuestas" component={EncuestasPage} />
        <Route path="/eventos" component={EventosPage} />
        <Route path="/asistente-ia" component={AsistenteIaPage} />
        <Route path="/panel-control" component={PanelControlPage} />
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
      <Route component={AuthedRoutes} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
