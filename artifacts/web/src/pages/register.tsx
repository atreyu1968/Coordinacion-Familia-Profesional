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
import { Eye, EyeOff } from "lucide-react";
import heroImage from "@/assets/login-hero.png";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        data: { token, name: name || undefined, email, password },
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
      return (
        <p className="text-sm text-muted-foreground">
          Comprobando invitación…
        </p>
      );
    }
    if (invitationError || !invitation) {
      return (
        <p className="text-sm text-destructive">
          La invitación no es válida o ha caducado. Solicita una nueva.
        </p>
      );
    }
    return (
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p>
            Invitación válida para el rol de{" "}
            <strong>{ROLE_LABELS[invitation.role] ?? invitation.role}</strong>
          </p>
          <p className="text-muted-foreground">
            Completa tus datos para crear la cuenta.
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
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@centro.es"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={registerMutation.isPending}
        >
          {registerMutation.isPending ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
    );
  };

  return (
    <div className="min-h-screen w-full grid lg:grid-cols-2 bg-background">
      {/* Left visual panel */}
      <div className="relative hidden lg:flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/40 p-12">
        <div className="absolute -bottom-24 -left-24 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -top-16 -right-10 w-72 h-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative z-10 flex flex-col items-center text-center gap-8 max-w-md">
          <div className="rounded-full ring-8 ring-background shadow-xl overflow-hidden w-80 h-80">
            <img
              src={heroImage}
              alt="Profesionales de Formación Profesional colaborando"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Tu futuro es la Formación Profesional
            </h2>
            <p className="text-muted-foreground">
              Plataforma de coordinación de la familia profesional de
              Administración y Gestión en Canarias.
            </p>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md space-y-8">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold shrink-0">
              ADG
            </div>
            <div className="leading-tight">
              <p className="font-bold text-lg">Coordina ADG</p>
              <p className="text-sm text-muted-foreground">
                Administración y Gestión · Canarias
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">Crear cuenta</h1>
            <p className="text-muted-foreground">
              Completa tu registro en Coordina ADG.
            </p>
          </div>

          {content()}

          <div className="pt-2 text-center">
            <a
              href="https://www.fpcanarias.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-semibold text-primary hover:underline"
            >
              www.fpcanarias.org
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
