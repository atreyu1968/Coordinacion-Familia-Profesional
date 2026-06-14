import QRCode from "qrcode";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// Generate a PNG data URL for a QR code encoding the given payload. Used to
// embed the accreditation QR inline in the email pass.
export async function generateQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

// Build a simple A4 landscape attendance certificate PDF and return it as a
// base64 string (suitable for a Resend attachment).
export async function generateCertificatePdfBase64(params: {
  attendeeName: string;
  eventName: string;
  location?: string | null;
  date?: Date | null;
  professionalFamily: string;
}): Promise<string> {
  const doc = await PDFDocument.create();
  // A4 landscape (points): 841.89 x 595.28
  const page = doc.addPage([841.89, 595.28]);
  const { width, height } = page.getSize();

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

  const ink = rgb(0.105, 0.286, 0.396); // #1b4965 brand
  const muted = rgb(0.39, 0.45, 0.55);
  const dark = rgb(0.1, 0.12, 0.16);

  // Border
  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: height - 56,
    borderColor: ink,
    borderWidth: 2,
  });

  const center = (
    text: string,
    y: number,
    size: number,
    font = serif,
    color = dark,
  ) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font, color });
  };

  center("COORDINA ADG", height - 110, 22, sans, ink);
  center(
    `Familia Profesional de ${params.professionalFamily} · Canarias`,
    height - 134,
    12,
    sans,
    muted,
  );
  center("Certificado de Asistencia", height - 210, 34, serifBold, dark);
  center("Se certifica que", height - 270, 16, serif, muted);
  center(params.attendeeName, height - 312, 28, serifBold, ink);
  center("ha asistido a la jornada", height - 352, 16, serif, muted);
  center(params.eventName, height - 392, 22, serifBold, dark);

  const details: string[] = [];
  if (params.location) details.push(params.location);
  if (params.date) details.push(new Date(params.date).toLocaleDateString("es-ES"));
  if (details.length > 0) {
    center(details.join(" · "), height - 426, 14, serif, muted);
  }

  const issued = `Expedido el ${new Date().toLocaleDateString("es-ES")}`;
  page.drawText(issued, { x: 70, y: 70, size: 11, font: sans, color: muted });

  const bytes = await doc.save();
  return Buffer.from(bytes).toString("base64");
}
