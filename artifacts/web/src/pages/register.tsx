import { useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "wouter";
import {
  useGetInvitationByToken,
  getGetInvitationByTokenQueryKey,
  useRegisterWithToken,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ROLE_LABELS: Record<string, string> = {
  superadmin: "Superadministración",
  coordinator: "Coordinación",
  prospector: "Prospección",
  department_head: "Jefatura de departamento",
  teacher: "Profesorado",
  student: "Alumnado",
};

export default function RegisterPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const {
    data: invitation,
    isLoading: invitationLoading,
    isError: invitationError,
  } = useGetInvitationByToken(token, {
    query: {
      queryKey: getGetInvitationByTokenQueryKey(token),
      enabled: !!token,
      retry: false,
    },
  });

  const registerMutation = useRegisterWithToken();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await registerMutation.mutateAsync({
        data: { token, name: name || undefined, password },
      });
      login(result.token, result.user);
      setLocation("/");
    } catch {
      setError("No se pudo completar el registro. Revisa los datos.");
    }
  };

  const content = () => {
    if (!token) {
      return (
        <p className="text-sm text-destructive">
          Falta el código de invitación en el enlace.
        </p>
      );
    }
    if (invitationLoading) {
      return <p className="text-sm text-muted-foreground">Comprobando invitación…</p>;
    }
    if (invitationError || !invitation) {
      return (
        <p className="text-sm text-destructive">
          La invitación no es válida o ha caducado. Solicita una nueva.
        </p>
      );
    }
    return (
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p>
            Invitación para <strong>{invitation.email}</strong>
          </p>
          <p className="text-muted-foreground">
            Rol: {ROLE_LABELS[invitation.role] ?? invitation.role}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Nombre completo</Label>
          <Input
            id="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tu nombre y apellidos"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto w-12 h-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
            ADG
          </div>
          <CardTitle className="text-2xl">Crear cuenta</CardTitle>
          <CardDescription>
            Completa tu registro en Coordina ADG
          </CardDescription>
        </CardHeader>
        <CardContent>{content()}</CardContent>
      </Card>
    </div>
  );
}
