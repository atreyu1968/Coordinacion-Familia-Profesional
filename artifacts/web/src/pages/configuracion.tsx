import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import PanelControlPage from "@/pages/panel-control";
import InvitacionesPage from "@/pages/invitaciones";
import CentrosPage from "@/pages/centros";
import CiclosModulos from "@/components/ciclos-modulos";
import AparienciaSettings from "@/components/apariencia-settings";

export default function ConfiguracionPage() {
  const { user } = useAuth();

  if (user && user.role !== "superadmin") {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">
          No tienes permiso para acceder a esta sección.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground">
          Integraciones, invitaciones, centros y catálogo de ciclos.
        </p>
      </div>
      <Tabs defaultValue="integraciones" className="space-y-6">
        <TabsList>
          <TabsTrigger value="integraciones">Integraciones y copias</TabsTrigger>
          <TabsTrigger value="apariencia">Apariencia</TabsTrigger>
          <TabsTrigger value="invitaciones">Invitaciones</TabsTrigger>
          <TabsTrigger value="centros">Centros</TabsTrigger>
          <TabsTrigger value="ciclos">Ciclos y módulos</TabsTrigger>
        </TabsList>
        <TabsContent value="integraciones">
          <PanelControlPage />
        </TabsContent>
        <TabsContent value="apariencia">
          <AparienciaSettings />
        </TabsContent>
        <TabsContent value="invitaciones">
          <InvitacionesPage />
        </TabsContent>
        <TabsContent value="centros">
          <CentrosPage />
        </TabsContent>
        <TabsContent value="ciclos">
          <CiclosModulos />
        </TabsContent>
      </Tabs>
    </div>
  );
}
