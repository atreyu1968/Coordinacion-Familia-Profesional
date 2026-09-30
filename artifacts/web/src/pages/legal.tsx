import { Link } from "wouter";
import { LEGAL_CONTROLLER, LEGAL_VERSION } from "@/lib/legal-content";
import { useBranding } from "@/lib/branding";

type LegalKind = "terms" | "privacy" | "cookies";

const titles: Record<LegalKind, string> = {
  terms: "Términos de uso",
  privacy: "Información sobre protección de datos",
  cookies: "Política de cookies y almacenamiento local",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}

function LegalPage({ kind }: { kind: LegalKind }) {
  const { appName } = useBranding();
  return (
    <main className="min-h-screen bg-background px-5 py-10 sm:py-14">
      <article className="mx-auto max-w-3xl space-y-9">
        <header className="space-y-3">
          <Link href="/login" className="text-sm text-primary underline underline-offset-4">
            Volver al acceso
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">{titles[kind]}</h1>
          <p className="text-sm text-muted-foreground">Versión {LEGAL_VERSION}</p>
        </header>

        <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>Borrador pendiente de completar.</strong> Falta el correo de privacidad
          y confirmar la dirección postal completa, además de revisar los servicios externos, plazos y bases jurídicas. Este texto
          informa de la implementación actual, pero no es asesoramiento legal ni debe
          publicarse como política definitiva sin revisión profesional.
        </div>

        {kind === "terms" && (
          <>
            <Section title="1. Finalidad y acceso">
              <p>{appName} facilita la coordinación y comunicación de la comunidad de Formación Profesional. El acceso requiere una invitación válida y una cuenta personal. El rol y el ámbito asignados determinan las funciones disponibles.</p>
            </Section>
            <Section title="2. Uso de la cuenta">
              <p>Debes proporcionar datos correctos, mantener tu contraseña en secreto y comunicar cualquier acceso no autorizado al responsable del servicio. No compartas tu cuenta ni utilices una invitación destinada a otro colectivo.</p>
            </Section>
            <Section title="3. Contenido y convivencia">
              <p>Utiliza las comunicaciones, archivos y espacios compartidos para sus fines profesionales, respetando la confidencialidad y los derechos de terceros. No publiques datos personales ajenos sin autorización ni contenido ilícito o que vulnere derechos.</p>
            </Section>
            <Section title="4. Disponibilidad, cambios y baja">
              <p>El servicio puede necesitar interrupciones de mantenimiento. Los permisos podrán retirarse si deja de existir la relación que justificó el acceso o se incumplen estas normas. Los cambios sustanciales de los términos se comunicarán antes de solicitar una nueva aceptación.</p>
              <p>Titular del servicio: {LEGAL_CONTROLLER.name}. Dirección indicada: {LEGAL_CONTROLLER.address}.</p>
            </Section>
          </>
        )}

        {kind === "privacy" && (
          <>
            <Section title="1. Responsable y contacto">
              <p>Responsable del tratamiento: {LEGAL_CONTROLLER.name}. Dirección indicada: {LEGAL_CONTROLLER.address}. Contacto para ejercer derechos o plantear consultas: {LEGAL_CONTROLLER.email}.</p>
            </Section>
            <Section title="2. Datos y finalidades">
              <p>Se tratan los datos de registro (nombre, correo, contraseña protegida mediante hash, rol y ámbito), información profesional y académica facilitada en la plataforma, mensajes, contenidos y archivos que las personas usuarias decidan aportar, y datos técnicos imprescindibles para la seguridad y operación.</p>
              <p>Se utilizan para crear y proteger cuentas, gestionar permisos, facilitar la coordinación, comunicaciones y colaboración, y atender incidencias. La base jurídica concreta de cada tratamiento y la información sobre datos de terceras personas aportados por usuarios están <strong>pendientes de validación por la entidad responsable</strong>.</p>
            </Section>
            <Section title="3. Destinatarios y conservación">
              <p>El acceso se limita según los roles y permisos de la aplicación. El alojamiento, correo, videoconferencias, almacenamiento colaborativo y funciones de IA pueden involucrar proveedores externos si están activados. <strong>Antes de publicar, identifique los proveedores reales, posibles transferencias internacionales y sus encargos de tratamiento.</strong></p>
              <p>Los plazos de conservación y el procedimiento de eliminación están <strong>pendientes de determinar por el responsable</strong>; no se presume que borrar una cuenta elimine automáticamente mensajes o documentos compartidos.</p>
            </Section>
            <Section title="4. Derechos">
              <p>Podrás solicitar al responsable acceso, rectificación, supresión, oposición, limitación y portabilidad cuando proceda, mediante el contacto indicado arriba. También podrás acudir a la Agencia Española de Protección de Datos si consideras que tus derechos no han sido atendidos.</p>
            </Section>
          </>
        )}

        {kind === "cookies" && (
          <>
            <Section title="Almacenamiento de la web principal">
              <p>El registro y el inicio de sesión utilizan almacenamiento local para mantener el token de acceso (<code>coordina_adg_token</code>) hasta cerrar sesión. La preferencia de menú lateral se guarda en almacenamiento local (<code>coordina_adg_sidebar_pinned</code>) y la cookie funcional <code>sidebar_state</code>, con duración máxima de siete días desde el último cambio.</p>
              <p>Esta web principal no incluye actualmente cookies de publicidad ni analítica. Por ello no se solicita aceptar cookies opcionales al registrarse. Puedes borrar los datos locales desde tu navegador; al borrar el token tendrás que volver a iniciar sesión.</p>
            </Section>
            <Section title="Servicios integrados">
              <p>Servicios externos que se abran desde la plataforma, como el espacio colaborativo o las videoconferencias, pueden establecer sus propias cookies según su configuración. Su inventario y, si procede, la gestión del consentimiento previo están <strong>pendientes de revisar antes de la publicación definitiva</strong>.</p>
            </Section>
          </>
        )}

        <nav aria-label="Otros textos legales" className="flex flex-wrap gap-x-5 gap-y-2 border-t pt-5 text-sm">
          <Link href="/terminos" className="text-primary underline underline-offset-4">Términos</Link>
          <Link href="/privacidad" className="text-primary underline underline-offset-4">Privacidad</Link>
          <Link href="/cookies" className="text-primary underline underline-offset-4">Cookies</Link>
        </nav>
      </article>
    </main>
  );
}

export function TermsPage() { return <LegalPage kind="terms" />; }
export function PrivacyPage() { return <LegalPage kind="privacy" />; }
export function CookiesPage() { return <LegalPage kind="cookies" />; }