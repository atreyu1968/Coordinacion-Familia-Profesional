import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import type { AttendanceCertificateSnapshot } from "@workspace/db";

declare const __CERTIFICATE_ASSETS_PATH__: string;
const fontDirectory = new URL(
  typeof __CERTIFICATE_ASSETS_PATH__ === "string" ? __CERTIFICATE_ASSETS_PATH__ : "../../assets/fonts/",
  import.meta.url,
);
const fontBytes = Promise.all([
  readFile(new URL("DejaVuSans.ttf", fontDirectory)),
  readFile(new URL("DejaVuSans-Bold.ttf", fontDirectory)),
]);
export const CANARY_ZONE = "Atlantic/Canary";
export function canaryDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CANARY_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}
const longDate = (value: string) => new Intl.DateTimeFormat("es-ES", {
  timeZone: CANARY_ZONE, dateStyle: "long",
}).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
const time = (value: string) => new Intl.DateTimeFormat("es-ES", {
  timeZone: CANARY_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
}).format(new Date(value));

function lines(text: string, font: PDFFont, size: number, width: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.normalize("NFC").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        if (line) result.push(line);
        line = "";
        // Long words/URLs must also wrap, rather than run outside the page.
        for (const char of word) {
          if (font.widthOfTextAtSize(line + char, size) > width && line) {
            result.push(line);
            line = "";
          }
          line += char;
        }
      }
    }
    result.push(line);
  }
  return result;
}

/** A4 portrait, based on the supplied certificate. No academic/digital-signature claims. */
export async function attendanceCertificatePdf(
  s: AttendanceCertificateSnapshot,
  options: { draft?: boolean; revoked?: boolean } = {},
): Promise<string> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Certificado de asistencia - ${s.eventName}`);
  doc.setAuthor(s.appName);
  doc.setCreationDate(new Date(s.issuedAt));
  doc.setModificationDate(new Date(s.issuedAt));
  const page = doc.addPage([595.28, 841.89]);
  doc.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await fontBytes;
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const sans = regular;
  const ink = rgb(0.1, 0.28, 0.4);
  const dark = rgb(0.13, 0.16, 0.2);
  const muted = rgb(0.4, 0.44, 0.48);
  const width = 455;
  const left = 70;
  const draw = (text: string, y: number, size: number, font = regular, centered = false) => {
    page.drawText(text, {
      x: centered ? (595.28 - font.widthOfTextAtSize(text, size)) / 2 : left,
      y, size, font, color: dark,
    });
  };
  // Avoid overlong branding spilling outside the document.
  let headerY = 788;
  for (const line of lines(s.appName, sans, 17, width)) {
    draw(line, headerY, 17, sans);
    headerY -= 20;
  }
  for (const line of lines(`Familia Profesional de ${s.professionalFamily}`, sans, 10, width)) {
    draw(line, headerY - 3, 10, sans);
    headerY -= 13;
  }
  page.drawLine({ start: { x: left, y: headerY - 17 }, end: { x: 525, y: headerY - 17 }, color: ink, thickness: 1.2 });
  draw("CERTIFICADO DE ASISTENCIA", headerY - 56, 19, bold, true);

  const duration = `${Math.floor(s.durationMinutes / 60) ? `${Math.floor(s.durationMinutes / 60)} h ` : ""}${s.durationMinutes % 60 ? `${s.durationMinutes % 60} min` : ""}`.trim();
  const dates = canaryDay(new Date(s.startAt)) === canaryDay(new Date(s.endAt))
    ? `el día ${longDate(s.startAt)}, en horario de ${time(s.startAt)} a ${time(s.endAt)} horas`
    : `del ${longDate(s.startAt)} a las ${time(s.startAt)} horas al ${longDate(s.endAt)} a las ${time(s.endAt)} horas`;
  const mode = s.modality === "videoconferencia" ? "por videoconferencia"
    : s.modality === "hibrida" ? "en modalidad híbrida" : "de forma presencial";
  const paragraphs = [
    `${s.signerName}, en calidad de ${s.signerRole},`,
    "CERTIFICA",
    `Que ${s.attendeeName} ha asistido al evento «${s.eventName}», celebrado ${mode}${s.location ? ` (${s.location})` : ""} ${dates}, con una duración de ${duration}.`,
    ...(s.additionalText ? [s.additionalText] : []),
    "Y para que así conste, a los efectos oportunos, se expide el presente certificado.",
    `En ${s.issuePlace}, a ${longDate(s.issueDate)}.`,
  ];
  const startY = headerY - 108;
  let size = 13;
  // Fit the complete body before the signature/QR area; never clip long names.
  for (; size >= 9; size -= 0.5) {
    const height = paragraphs.reduce((n, p) => n + lines(p, regular, size, width).length * size * 1.45 + 15, 0);
    if (startY - height >= 180) break;
  }
  if (size < 9) throw new Error("El texto del certificado es demasiado largo; reduce el texto adicional o el cargo.");
  let y = startY;
  for (const paragraph of paragraphs) {
    const certifies = paragraph === "CERTIFICA";
    for (const line of lines(paragraph, certifies ? bold : regular, size, width)) {
      draw(line, y, size, certifies ? bold : regular, certifies);
      y -= size * 1.45;
    }
    y -= 15;
  }
  let signatureSize = 11;
  while (signatureSize > 7 && (
    lines(`Fdo.: ${s.signerName}`, bold, signatureSize, 335).length * signatureSize * 1.3 +
    lines(s.signerRole, regular, signatureSize - 1, 335).length * signatureSize * 1.2
  ) > 78) signatureSize -= 0.5;
  let signatureY = 157;
  for (const line of lines(`Fdo.: ${s.signerName}`, bold, signatureSize, 335)) {
    draw(line, signatureY, signatureSize, bold);
    signatureY -= signatureSize * 1.3;
  }
  for (const line of lines(s.signerRole, regular, signatureSize - 1, 335)) {
    draw(line, signatureY, signatureSize - 1);
    signatureY -= signatureSize * 1.2;
  }
  if (!options.draft && s.verificationUrl) {
    const png = await QRCode.toBuffer(s.verificationUrl, { width: 300, margin: 2, errorCorrectionLevel: "M" });
    const image = await doc.embedPng(png);
    page.drawImage(image, { x: 440, y: 73, width: 85, height: 85 });
    page.drawText(s.code, { x: left, y: 68, size: 9, font: sans, color: ink });
    page.drawText("Escanea el QR y compara nombre, evento y fechas con el registro.", {
      x: left, y: 49, size: 8, font: sans, color: muted,
    });
    page.drawText("Verificación electrónica de autenticidad. No es una firma electrónica cualificada.", {
      x: left, y: 35, size: 7, font: sans, color: muted,
    });
  }
  if (options.draft || options.revoked) {
    const stamp = options.draft ? "BORRADOR - SIN VALIDEZ" : "CERTIFICADO ANULADO";
    page.drawText(stamp, { x: 95, y: 190, font: bold, size: 25, color: rgb(0.7, 0.08, 0.08), opacity: 0.65 });
  }
  return Buffer.from(await doc.save()).toString("base64");
}
