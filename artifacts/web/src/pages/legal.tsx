import { Link } from "wouter";
import { LEGAL_CONTROLLER, LEGAL_VERSION } from "@/lib/legal-content";
import { useBranding } from "@/lib/branding";
import { CookiePolicy } from "@/components/cookie-policy";

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
          <p className="text-sm text-muted-foreground">
            Última actualización: 21 de octubre de 2026
            {kind !== "cookies" && <span className="block">Versión {LEGAL_VERSION}</span>}
          </p>
        </header>

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
              <p>Titular del servicio indicado: {LEGAL_CONTROLLER.name}. Dirección publicada del centro de referencia: {LEGAL_CONTROLLER.address}. Correo de contacto para este servicio: <a className="text-primary underline" href={`mailto:${LEGAL_CONTROLLER.email}`}>{LEGAL_CONTROLLER.email}</a>.</p>
            </Section>
          </>
        )}

        {kind === "privacy" && (
          <>
            <Section title="1. Responsable y contacto">
              <p>Responsable indicado del tratamiento: {LEGAL_CONTROLLER.name}. Dirección publicada del centro de referencia: {LEGAL_CONTROLLER.address}. Para consultas y ejercicio de derechos: <a className="text-primary underline" href={`mailto:${LEGAL_CONTROLLER.email}`}>{LEGAL_CONTROLLER.email}</a>.</p>
            </Section>
            <Section title="2. Datos y finalidades">
              <p>Se tratan los datos de registro (nombre, correo, contraseña protegida mediante hash, rol, centro y ámbito), asignaciones y confirmaciones profesionales o académicas, y la fecha y versión de los textos aceptados. Según las funciones utilizadas, se tratan mensajes, encuestas, formularios, eventos, acreditaciones, contenidos, archivos y datos de otras personas que los usuarios aporten.</p>
              <p>También se usan datos técnicos necesarios para la autenticación, seguridad, registros de funcionamiento y notificaciones, como identificadores de dispositivo o suscripciones push cuando se habilitan. Las encuestas configuradas como anónimas separan la participación de las respuestas; no debe presuponerse anonimato en otras funciones.</p>
              <p>Se utilizan para crear y proteger cuentas, gestionar permisos e invitaciones, organizar la coordinación educativa, facilitar comunicaciones y colaboración, gestionar actividades y documentos y atender incidencias. Las bases jurídicas específicas por finalidad y las condiciones del tratamiento de datos de terceros aportados por usuarios no se detallan en este aviso; para obtener esta información, contacta con el responsable mediante el correo indicado. El registro de lectura de este aviso no constituye consentimiento para tratamientos opcionales.</p>
            </Section>
            <Section title="3. Destinatarios y conservación">
              <p>Dentro de la aplicación, el acceso depende del rol, ámbito y permisos. Según la instalación y las funciones habilitadas, pueden intervenir el proveedor de alojamiento y almacenamiento, Resend (correo), Nextcloud/Collabora (documentos), Jitsi o 8x8 JaaS (videoconferencias), DeepSeek (funciones de IA) y Expo Push Service (avisos al móvil). Esta lista describe integraciones previstas por el código, <strong>no confirma cuáles se utilizan en una instalación concreta</strong>. Deben verificarse los encargados reales, ubicaciones, posibles transferencias internacionales y garantías aplicables.</p>
              <p>Desactivar una cuenta no elimina automáticamente sus datos de la base de datos. Los mensajes y documentos compartidos, archivos almacenados, copias de seguridad y registros del servidor pueden persistir. <strong>El responsable debe establecer y aplicar plazos y procedimientos de conservación, bloqueo y supresión para cada categoría</strong>; no existe en la aplicación una purga general que permita prometer hoy un plazo único.</p>
            </Section>
            <Section title="4. Derechos">
              <p>Podrás solicitar al responsable acceso, rectificación, supresión, oposición, limitación y portabilidad cuando proceda, mediante el correo indicado arriba. También podrás acudir a la <a className="text-primary underline" href="https://www.aepd.es/" target="_blank" rel="noopener noreferrer">Agencia Española de Protección de Datos</a> si consideras que tus derechos no han sido atendidos.</p>
            </Section>
          </>
        )}

        {kind === "cookies" && <CookiePolicy />}

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