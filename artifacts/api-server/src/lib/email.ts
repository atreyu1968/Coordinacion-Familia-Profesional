import { getSettings, isResendConfigured } from "./settings";
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
export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
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

export function buildInvitationEmail(params: {
  inviterName: string;
  inviteUrl: string;
  role: string;
}): { subject: string; html: string } {
  return {
    subject: "Invitación a Coordina ADG",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
        <h2>Coordina ADG</h2>
        <p>${params.inviterName} te ha invitado a unirte a la plataforma de coordinación de la familia profesional de Administración y Gestión.</p>
        <p>Para completar tu registro, haz clic en el siguiente enlace:</p>
        <p><a href="${params.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#1b4965;color:#fff;text-decoration:none;border-radius:6px;">Completar registro</a></p>
        <p>O copia esta dirección en tu navegador:<br>${params.inviteUrl}</p>
      </div>
    `,
  };
}
