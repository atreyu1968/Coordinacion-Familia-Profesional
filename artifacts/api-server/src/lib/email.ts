import {
  getSettings,
  isResendConfigured,
  DEFAULT_PROFESSIONAL_FAMILY,
} from "./settings";
import { logger } from "./logger";

export interface SendEmailResult {
  sent: boolean;
  pending: boolean;
}

/**
 * Sends an email via Resend when configured. When Resend is not configured the
 * call degrades gracefully: nothing is sent and `pending` is returned so the
 * caller can surface the invite link manually ("pendiente de configuración").
 */
export interface EmailAttachment {
  filename: string;
  // Base64-encoded file content.
  content: string;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}): Promise<SendEmailResult> {
  const settings = await getSettings();

  if (!isResendConfigured(settings)) {
    return { sent: false, pending: true };
  }

  const from = settings.resendFromEmail ?? "Coordina ADG <onboarding@resend.dev>";

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.attachments && params.attachments.length > 0
          ? { attachments: params.attachments }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error({ status: response.status, body }, "Resend email failed");
      return { sent: false, pending: false };
    }

    return { sent: true, pending: false };
  } catch (err) {
    logger.error({ err }, "Resend email error");
    return { sent: false, pending: false };
  }
}

export function buildCompanyAlertEmail(params: {
  companyName: string;
  sector?: string | null;
  location?: string | null;
  positions?: number | null;
  description?: string | null;
  contact?: string | null;
  publishedByName?: string | null;
}): { subject: string; html: string } {
  const rows: string[] = [];
  if (params.sector) rows.push(`<strong>Sector:</strong> ${params.sector}`);
  if (params.location)
    rows.push(`<strong>Localidad:</strong> ${params.location}`);
  if (params.positions != null)
    rows.push(`<strong>Plazas:</strong> ${params.positions}`);
  if (params.contact) rows.push(`<strong>Contacto:</strong> ${params.contact}`);

  return {
    subject: `Nueva empresa para FCT: ${params.companyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Coordina ADG · Nueva alerta de empresa</h2>
        <p>${params.publishedByName ?? "Un prospector"} ha publicado una nueva empresa para prácticas (FCT/Dual):</p>
        <h3 style="margin-bottom:4px;">${params.companyName}</h3>
        ${rows.length ? `<p>${rows.join("<br>")}</p>` : ""}
        ${params.description ? `<p>${params.description}</p>` : ""}
        <p>Accede a la plataforma para consultar los detalles en el módulo de FCT y Prospección.</p>
      </div>
    `,
  };
}

export function buildAccreditationEmail(params: {
  eventName: string;
  holderName: string;
  role: string;
  location?: string | null;
  startAt?: Date | null;
  qrToken: string;
  qrDataUrl: string;
}): { subject: string; html: string } {
  const roleLabels: Record<string, string> = {
    participant: "Participante",
    jury: "Jurado",
    authority: "Autoridad",
    staff: "Organización",
  };
  const rows: string[] = [];
  if (params.location)
    rows.push(`<strong>Lugar:</strong> ${params.location}`);
  if (params.startAt)
    rows.push(
      `<strong>Fecha:</strong> ${new Date(params.startAt).toLocaleString("es-ES")}`,
    );

  return {
    subject: `Acreditación · ${params.eventName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Coordina ADG · Acreditación</h2>
        <p>Hola ${params.holderName}, esta es tu acreditación como
        <strong>${roleLabels[params.role] ?? params.role}</strong> para:</p>
        <h3 style="margin-bottom:4px;">${params.eventName}</h3>
        ${rows.length ? `<p>${rows.join("<br>")}</p>` : ""}
        <p>Presenta este código QR en el control de acceso:</p>
        <p style="text-align:center;">
          <img src="${params.qrDataUrl}" alt="QR de acceso" width="220" height="220" style="border:1px solid #e2e8f0;border-radius:8px;" />
        </p>
        <p style="text-align:center;color:#64748b;font-size:12px;">Código: ${params.qrToken}</p>
      </div>
    `,
  };
}

export function buildInvitationEmail(params: {
  inviterName: string;
  inviteUrl: string;
  role: string;
  professionalFamily?: string;
}): { subject: string; html: string } {
  const family = (params.professionalFamily ?? "").trim() || DEFAULT_PROFESSIONAL_FAMILY;
  return {
    subject: "Invitación a Coordina ADG",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Coordina ADG</h2>
        <p>${params.inviterName} te ha invitado a unirte a la plataforma de coordinación de la familia profesional de ${family}.</p>
        <p>Para completar tu registro, haz clic en el siguiente enlace:</p>
        <p><a href="${params.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#1b4965;color:#fff;text-decoration:none;border-radius:6px;">Completar registro</a></p>
        <p>O copia esta dirección en tu navegador:<br>${params.inviteUrl}</p>
      </div>
    `,
  };
}

export function buildYearConfirmationEmail(params: {
  teacherName: string;
  schoolYear: string;
  deadline: Date;
  appUrl?: string | null;
}): { subject: string; html: string } {
  const deadlineLabel = new Date(params.deadline).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const link = (params.appUrl ?? "").trim().replace(/\/+$/, "");
  return {
    subject: `Confirma tu participación · Curso ${params.schoolYear}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color:#18181b;">
        <h2>Coordina ADG · Confirmación de curso</h2>
        <p>Hola ${params.teacherName},</p>
        <p>Ha comenzado el curso <strong>${params.schoolYear}</strong>. Para seguir
        activo en la plataforma debes confirmar el <strong>centro</strong> y los
        <strong>módulos</strong> que vas a impartir este curso.</p>
        <p>Tienes hasta el <strong>${deadlineLabel}</strong>. Si no confirmas antes
        de esa fecha, tu cuenta se desactivará automáticamente y deberás solicitar
        su reactivación al administrador.</p>
        ${
          link
            ? `<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1b4965;color:#fff;text-decoration:none;border-radius:6px;">Confirmar ahora</a></p>`
            : `<p>Accede a la plataforma para confirmar tu participación.</p>`
        }
      </div>
    `,
  };
}

export function buildPasswordResetEmail(params: {
  code: string;
}): { subject: string; html: string } {
  return {
    subject: "Código de recuperación de contraseña · Coordina ADG",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color:#18181b;">
        <h2>Coordina ADG · Recuperación de contraseña</h2>
        <p>Has solicitado restablecer tu contraseña. Usa el siguiente código de verificación:</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;background:#f4f4f5;border-radius:12px;padding:16px;margin:16px 0;">
          ${params.code}
        </div>
        <p style="color:#52525b;">Introduce este código en la aplicación para crear una nueva contraseña. El código caduca en <strong>15 minutos</strong>.</p>
        <p style="color:#a1a1aa;font-size:13px;">Si no has solicitado este cambio, puedes ignorar este mensaje.</p>
      </div>
    `,
  };
}
