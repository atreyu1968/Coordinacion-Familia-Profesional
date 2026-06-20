import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBranding,
  useUpdateBranding,
  useRequestUploadUrl,
  getGetBrandingQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Image, Type, Trash2, AlertTriangle, Lock } from "lucide-react";

// Same-origin public branding image routes (served by the API under /api).
function brandingAssetUrl(kind: "logo" | "favicon", version: string): string {
  return `/api/settings/branding/${kind}?v=${encodeURIComponent(version)}`;
}

export default function AparienciaSettings() {
  const qc = useQueryClient();
  const { data: branding, isLoading } = useGetBranding({
    query: { queryKey: getGetBrandingQueryKey() },
  });
  const updateMut = useUpdateBranding();
  const uploadMut = useRequestUploadUrl();

  const [appName, setAppName] = useState("");
  const [professionalFamily, setProfessionalFamily] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Changing the active professional family re-scopes the whole app, so it is
  // gated behind an explicit double confirmation (a warning dialog + an
  // acknowledgement checkbox the admin must tick before confirming).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setAppName(branding?.appName ?? "");
  }, [branding?.appName]);

  useEffect(() => {
    setProfessionalFamily(branding?.professionalFamily ?? "");
  }, [branding?.professionalFamily]);

  // Upload one image to object storage and return its normalized object path.
  const uploadImage = async (file: File): Promise<string> => {
    const res = await uploadMut.mutateAsync({
      data: { name: file.name, size: file.size, contentType: file.type },
    });
    const put = await fetch(res.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!put.ok) throw new Error("upload failed");
    return res.objectPath;
  };

  // Once an explicit family has been persisted it is permanent and can never be
  // changed: the whole instance is locked to a single family so cycles/modules
  // never mix across families.
  const familyLocked = branding?.professionalFamilyLocked === true;
  const familyChanged =
    !familyLocked &&
    professionalFamily.trim() !== (branding?.professionalFamily ?? "");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Re-scoping the app is consequential: require the extra confirmation step
    // before saving when (and only when) the active family actually changes.
    if (familyChanged) {
      setAcknowledged(false);
      setConfirmOpen(true);
      return;
    }
    void doSave();
  };

  const doSave = async () => {
    setSavedMessage(null);
    setErrorMessage(null);
    setSaving(true);
    try {
      const payload: {
        appName?: string | null;
        professionalFamily?: string | null;
        logoPath?: string | null;
        faviconPath?: string | null;
      } = {};

      const trimmedName = appName.trim();
      if (trimmedName !== (branding?.appName ?? "")) {
        payload.appName = trimmedName || null;
      }
      const trimmedFamily = professionalFamily.trim();
      if (trimmedFamily !== (branding?.professionalFamily ?? "")) {
        payload.professionalFamily = trimmedFamily || null;
      }
      if (logoFile) payload.logoPath = await uploadImage(logoFile);
      if (faviconFile) payload.faviconPath = await uploadImage(faviconFile);

      if (Object.keys(payload).length === 0) {
        setSavedMessage("No hay cambios que guardar.");
        setSaving(false);
        return;
      }

      await updateMut.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
      setLogoFile(null);
      setFaviconFile(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      if (faviconInputRef.current) faviconInputRef.current.value = "";
      setSavedMessage("Apariencia guardada correctamente.");
    } catch {
      setErrorMessage("No se pudo guardar la apariencia. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  const onClearLogo = async () => {
    setSavedMessage(null);
    setErrorMessage(null);
    setSaving(true);
    try {
      await updateMut.mutateAsync({ data: { logoPath: null } });
      await qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
      setLogoFile(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      setSavedMessage("Logotipo restablecido al valor por defecto.");
    } catch {
      setErrorMessage("No se pudo restablecer el logotipo.");
    } finally {
      setSaving(false);
    }
  };

  const onClearFavicon = async () => {
    setSavedMessage(null);
    setErrorMessage(null);
    setSaving(true);
    try {
      await updateMut.mutateAsync({ data: { faviconPath: null } });
      await qc.invalidateQueries({ queryKey: getGetBrandingQueryKey() });
      setFaviconFile(null);
      if (faviconInputRef.current) faviconInputRef.current.value = "";
      setSavedMessage("Icono restablecido al valor por defecto.");
    } catch {
      setErrorMessage("No se pudo restablecer el icono.");
    } finally {
      setSaving(false);
    }
  };

  const version = branding?.version ?? "0";
  const logoPreview = logoFile
    ? URL.createObjectURL(logoFile)
    : branding?.hasLogo
      ? brandingAssetUrl("logo", version)
      : null;
  const faviconPreview = faviconFile
    ? URL.createObjectURL(faviconFile)
    : branding?.hasFavicon
      ? brandingAssetUrl("favicon", version)
      : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Apariencia</h1>
        <p className="text-muted-foreground">
          Personaliza el nombre, el logotipo y el icono (favicon) de la
          plataforma. Si dejas un recurso sin configurar, se usará el valor por
          defecto de la aplicación.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Type className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Nombre de la aplicación</CardTitle>
            </div>
            <CardDescription>
              Aparece en la pestaña del navegador y como texto alternativo del
              logotipo. Déjalo vacío para usar «Coordina ADG».
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="appName">Nombre</Label>
              <Input
                id="appName"
                type="text"
                placeholder="Coordina ADG"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                maxLength={80}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Type className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Familia profesional</CardTitle>
            </div>
            <CardDescription>
              Familia profesional a la que se destina la aplicación. Se usa en los
              textos de la plataforma (acceso, correos, descripciones) y como
              filtro por defecto en Centros. Déjala vacía para usar «Administración
              y Gestión».
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="professionalFamily">Familia profesional</Label>
              <Input
                id="professionalFamily"
                type="text"
                placeholder="Administración y Gestión"
                value={professionalFamily}
                onChange={(e) => setProfessionalFamily(e.target.value)}
                maxLength={120}
                disabled={familyLocked}
                readOnly={familyLocked}
              />
              {familyLocked ? (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    La familia profesional ya está definida y es{" "}
                    <strong>permanente</strong>: no puede cambiarse bajo ningún
                    concepto. Toda la aplicación —incluidos los espacios
                    colaborativos y la documentación— queda restringida a los
                    ciclos y módulos de esta familia.
                  </span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Elige con cuidado: una vez guardada, la familia profesional
                  queda fijada de forma permanente y no se podrá cambiar.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Image className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Logotipo</CardTitle>
            </div>
            <CardDescription>
              Se muestra en la cabecera y en la pantalla de acceso. Usa un PNG o
              SVG con fondo transparente para mejores resultados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {logoPreview && (
              <div className="flex h-16 items-center rounded-md border bg-muted/40 p-2">
                <img
                  src={logoPreview}
                  alt="Vista previa del logotipo"
                  className="h-full w-auto object-contain"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="max-w-xs"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
              {branding?.hasLogo && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClearLogo}
                  disabled={saving}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Restablecer
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Image className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Icono (favicon)</CardTitle>
            </div>
            <CardDescription>
              Pequeño icono que aparece en la pestaña del navegador. Se recomienda
              una imagen cuadrada (por ejemplo, 512×512 px) en PNG.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {faviconPreview && (
              <div className="flex h-16 items-center rounded-md border bg-muted/40 p-2">
                <img
                  src={faviconPreview}
                  alt="Vista previa del icono"
                  className="h-12 w-12 object-contain"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Input
                ref={faviconInputRef}
                type="file"
                accept="image/png,image/x-icon,image/svg+xml,image/webp"
                className="max-w-xs"
                onChange={(e) => setFaviconFile(e.target.files?.[0] ?? null)}
              />
              {branding?.hasFavicon && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClearFavicon}
                  disabled={saving}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Restablecer
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {savedMessage && (
          <p className="text-sm font-medium text-green-600">{savedMessage}</p>
        )}
        {errorMessage && (
          <p className="text-sm font-medium text-destructive">{errorMessage}</p>
        )}

        <Button type="submit" disabled={isLoading || saving}>
          {saving ? "Guardando…" : "Guardar cambios"}
        </Button>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Cambiar la familia profesional activa
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Toda la aplicación está restringida a la familia profesional
                  activa. Si la cambias de{" "}
                  <strong>«{branding?.professionalFamily || "Administración y Gestión"}»</strong>{" "}
                  a <strong>«{professionalFamily.trim() || "Administración y Gestión"}»</strong>,
                  el directorio de centros, el panel y los informes pasarán a
                  mostrar únicamente la nueva familia para <strong>todas las
                  personas usuarias</strong>.
                </p>
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={acknowledged}
                    onCheckedChange={(v) => setAcknowledged(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    Entiendo que este cambio afecta a lo que ve toda la
                    plataforma y confirmo que quiero continuar.
                  </span>
                </label>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!acknowledged}
              onClick={() => {
                setConfirmOpen(false);
                void doSave();
              }}
            >
              Sí, cambiar la familia activa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
