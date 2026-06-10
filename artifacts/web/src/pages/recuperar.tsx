import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { useForgotPassword, useResetPassword } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react";
import logo from "@/assets/logo.png";

type Step = "email" | "code" | "done";

export default function RecuperarPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forgot = useForgotPassword();
  const reset = useResetPassword();

  const onRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await forgot.mutateAsync({ data: { email: email.trim().toLowerCase() } });
      setStep("code");
    } catch {
      setError("No se pudo enviar el código. Inténtalo de nuevo.");
    }
  };

  const onReset = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    try {
      await reset.mutateAsync({
        data: {
          email: email.trim().toLowerCase(),
          code: code.trim(),
          newPassword,
        },
      });
      setStep("done");
    } catch {
      setError("Código no válido o caducado. Revisa tu correo o solicita uno nuevo.");
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-accent/40 p-6">
      <div className="w-full max-w-md space-y-8 rounded-2xl bg-background p-8 shadow-xl ring-1 ring-border">
        <img src={logo} alt="Coordina ADG" className="h-12 w-auto" />

        {step === "email" && (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">
                Recuperar contraseña
              </h1>
              <p className="text-muted-foreground">
                Introduce tu correo y te enviaremos un código de verificación.
              </p>
            </div>
            <form onSubmit={onRequest} className="space-y-5">
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
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={forgot.isPending}
              >
                {forgot.isPending ? "Enviando…" : "Enviar código"}
              </Button>
            </form>
          </>
        )}

        {step === "code" && (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">
                Introduce el código
              </h1>
              <p className="text-muted-foreground">
                Hemos enviado un código de 6 dígitos a{" "}
                <span className="font-medium text-foreground">{email}</span>.
                Caduca en 15 minutos.
              </p>
            </div>
            <form onSubmit={onReset} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="code">Código de verificación</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  className="text-center text-2xl tracking-[0.5em]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">Nueva contraseña</Label>
                <div className="relative">
                  <Input
                    id="newPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="pr-10"
                    placeholder="Mínimo 8 caracteres"
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
                disabled={reset.isPending}
              >
                {reset.isPending ? "Guardando…" : "Cambiar contraseña"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError(null);
                  setCode("");
                }}
                className="flex w-full items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" /> Usar otro correo
              </button>
            </form>
          </>
        )}

        {step === "done" && (
          <div className="space-y-6 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-primary" />
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">
                Contraseña actualizada
              </h1>
              <p className="text-muted-foreground">
                Ya puedes iniciar sesión con tu nueva contraseña.
              </p>
            </div>
            <Button
              className="w-full"
              size="lg"
              onClick={() => setLocation("/login")}
            >
              Ir a iniciar sesión
            </Button>
          </div>
        )}

        {step !== "done" && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => setLocation("/login")}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Volver a iniciar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
