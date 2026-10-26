import { Link, useLocation, useSearch } from "wouter";

export function useNoticeId(param = "aviso") {
  const raw = new URLSearchParams(useSearch()).get(param);
  return raw && /^[1-9]\d*$/.test(raw) && Number(raw) <= 2147483647 ? Number(raw) : null;
}

/** Filter only server-authorized results; a URL identifier never expands access. */
export function useNoticeItems<T>(items: T[], key: keyof T = "id" as keyof T, param = "aviso"): T[] {
  const id = useNoticeId(param);
  return id == null ? items : items.filter((item) => item[key] === id);
}

export function NotificationSelection() {
  const id = useNoticeId();
  const calendarId = useNoticeId("calendario");
  const [path] = useLocation();
  if (id == null && calendarId == null) return null;
  return <div role="status" className="m-4 rounded-md border p-3 text-sm">
    Elemento del aviso. Si no aparece, ya no está disponible o no tienes acceso.{" "}
    <Link href={path} className="underline">Ver toda la sección</Link>
  </div>;
}
