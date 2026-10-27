import type { NotificationTarget } from "./generated/api.schemas";

/** Fixed internal routes only. Neither persisted URLs nor push-supplied paths are trusted. */
export function notificationTargetPath(value: unknown, platform: "web" | "mobile"): string | null {
  if (!value || typeof value !== "object") return null;
  const { kind, id } = value as Partial<NotificationTarget>;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > 2147483647) return null;
  if (platform === "web") {
    switch (kind) {
      case "normativa": return `/documentacion?normativa=${id}`;
      case "event": return `/eventos?evento=${id}`;
      case "course": return `/autodirigido?curso=${id}`;
      case "chat": return `/chat?grupo=${id}`;
      case "survey": return `/encuestas?aviso=${id}`;
      case "form": return `/formularios?aviso=${id}`;
      case "forum": return `/foros?tema=${id}`;
      case "space": return `/espacio?aviso=${id}`;
      case "announcement": return `/anuncios?aviso=${id}`;
      case "meeting": return `/videoconferencias?aviso=${id}`;
      case "company_alert": return `/fct?aviso=${id}`;
      case "minutes": return `/actas?aviso=${id}`;
      case "certificate_event": return `/mis-certificados?aviso=${id}`;
      case "calendar": return `/eventos?calendario=${id}`;
      default: return null;
    }
  }
  switch (kind) {
    case "event": return `/eventos?aviso=${id}`;
    case "calendar": return `/eventos?calendario=${id}`;
    case "course": return `/lms/${id}`;
    case "chat": return `/chat/${id}`;
    case "survey": return `/survey/${id}`;
    case "form": return `/form/${id}`;
    case "forum": return `/foros/tema/${id}`;
    case "space": return `/espacios-colaborativos?aviso=${id}`;
    case "announcement": return `/?aviso=${id}`;
    case "meeting": return `/videoconferencias?aviso=${id}`;
    case "company_alert": return `/alerts?aviso=${id}`;
    case "minutes": return `/acta/${id}`;
    case "certificate_event": return `/mis-certificados?aviso=${id}`;
    default: return null;
  }
}
