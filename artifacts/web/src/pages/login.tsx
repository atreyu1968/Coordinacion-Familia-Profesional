import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
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

export default function LoginPage() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loginMutation = useLogin();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await loginMutation.mutateAsync({
        data: { email, password },
      });
      login(result.token, result.user);
      setLocation("/");
    } catch {
      setError("Correo o contraseña incorrectos. Inténtalo de nuevo.");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto w-12 h-12 rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold">
            ADG
          </div>
          <CardTitle className="text-2xl">Coordina ADG</CardTitle>
          <CardDescription>
            Accede a la plataforma de coordinación de la familia profesional de
            Administración y Gestión
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Correo electrónico</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nombre@centro.es"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
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
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Accediendo…" : "Iniciar sesión"}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-muted-foreground">
            ¿Tienes un código de invitación? Usa el enlace recibido por correo
            para registrarte.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
