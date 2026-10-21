export function escapeEmailHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function emailLink(url: string): string {
  const parsed = new URL(url);
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Invalid email link");
  }
  return escapeEmailHtml(parsed.href);
}

export function emailHtmlToText(html: string): string {
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>|<\/(?:p|div|h[1-6]|tr|table)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
    })[entity]!)
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildEmailLayout(params: {
  appName: string;
  professionalFamily: string;
  subject: string;
  content: string;
  logoSrc?: string;
}): { html: string; text: string } {
  const name = escapeEmailHtml(params.appName);
  const family = escapeEmailHtml(params.professionalFamily);
  const subject = escapeEmailHtml(params.subject);
  const logo = escapeEmailHtml(params.logoSrc ?? "cid:application-logo");
  return {
    html: `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>${subject}</title>
<style>body{margin:0;padding:0}p{margin:0 0 16px;line-height:1.65}h2{margin:0 0 20px;font-size:24px;line-height:1.3;color:#102c50}h3{color:#102c50}a{color:#0758b5}img{border:0} @media(max-width:600px){.email-content{padding:24px 20px!important}.email-header{padding:28px 20px!important}}</style>
</head><body style="margin:0;background:#f1f5f9;color:#26364b;font-family:Arial,Helvetica,sans-serif;font-size:15px">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${subject}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #dce5ef;border-radius:12px;overflow:hidden">
<tr><td style="height:6px;background:#0758b5;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td class="email-header" align="center" style="padding:32px 32px 24px;border-bottom:1px solid #e6edf5">
<img src="${logo}" alt="${name}" width="280" style="display:block;width:280px;max-width:100%;height:auto;margin:0 auto 16px">
<div style="font-size:18px;font-weight:700;color:#102c50">${name}</div>
<div style="margin-top:6px;font-size:12px;line-height:1.5;color:#64748b">Familia profesional de ${family}</div>
</td></tr>
<tr><td class="email-content" style="padding:32px;line-height:1.65">${params.content}</td></tr>
<tr><td style="padding:22px 28px;background:#f8fafc;border-top:1px solid #e6edf5;font-size:12px;line-height:1.6;color:#64748b">
<strong style="color:#475569">${name}</strong><br>Este mensaje se ha generado automáticamente desde la plataforma. Para realizar gestiones, accede a la aplicación.
</td></tr></table>
<p style="margin:18px 0 0;font-size:11px;line-height:1.5;color:#64748b">No compartas contraseñas ni códigos personales de verificación.</p>
</td></tr></table></body></html>`,
    text: `${params.appName}\nFamilia profesional de ${params.professionalFamily}\n\n${emailHtmlToText(params.content)}\n\n${params.appName} · Mensaje automático de la plataforma.\nNo compartas contraseñas ni códigos personales de verificación.`,
  };
}
