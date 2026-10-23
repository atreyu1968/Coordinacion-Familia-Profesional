import { useState } from "react";
import { AutoLinkText } from "@/components/auto-link-text";
import { Bell } from "lucide-react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkNotificationRead,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

function destination(type: string | null | undefined, role: string) {
  switch (type) {
    case "certificate":
      return { href: "/mis-certificados", label: "Ver mis certificados" };
    case "meeting_minutes":
      return role === "department_head"
        ? { href: "/actas", label: "Ver actas publicadas" }
        : { href: "/eventos", label: "Ver eventos" };
    case "collaborative_space":
      return { href: "/espacio", label: "Ir a Espacio colaborativo" };
    case "message":
    case "chat_group":
      return { href: "/chat", label: "Ver mensajes" };
    case "survey":
      return { href: "/encuestas", label: "Ver encuestas" };
    case "document_form":
      return { href: "/formularios", label: "Ver formularios" };
    case "meeting":
      return { href: "/videoconferencias", label: "Ver reuniones" };
    case "company_alert":
      return { href: "/fct", label: "Ver avisos" };
    case "forum_thread":
    case "forum_reply":
      return { href: "/foros", label: "Ver foros" };
    case "year_confirmation":
      return { href: "/academica", label: "Ver coordinación académica" };
    case "announcement":
      return { href: "/anuncios", label: "Ver anuncios" };
    case "lms_course":
      return { href: "/autodirigido", label: "Ver cursos autodirigidos" };
    case "event":
    case "calendar":
      return { href: "/eventos", label: "Ver eventos" };
    default:
      return { href: "/", label: "Ir al panel principal" };
  }
}

export function AppNotifications({ userId, role }: { userId: number; role: string }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const queryKey = [...getListNotificationsQueryKey(), userId];
  const notices = useListNotifications({
    query: { queryKey, refetchInterval: 30_000, refetchOnMount: "always" },
  });
  const markRead = useMarkNotificationRead({
    mutation: { onSuccess: () => client.invalidateQueries({ queryKey }) },
  });
  const items = notices.data ?? [];
  const unread = items.filter((item) => !item.readAt).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label={`Notificaciones${unread ? `: ${unread} sin leer` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-0 top-0 rounded-full bg-destructive px-1 text-[10px] text-white">{unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <h2 className="font-semibold mb-3">Notificaciones</h2>
        {notices.isLoading ? <p className="text-sm">Cargando avisos…</p>
          : notices.isError ? <div className="text-sm">No se pudieron cargar los avisos. <Button variant="link" onClick={() => void notices.refetch()}>Reintentar</Button></div>
          : items.length === 0 ? <p className="text-sm text-muted-foreground">No tienes notificaciones.</p>
          : items.map((item) => (
              (() => {
                const target = destination(item.type, role);
                return (
                  <div key={item.id}
                    className={`rounded-md p-3 mb-1 hover:bg-accent ${!item.readAt ? "bg-accent/60" : ""}`}>
                    <p className="text-sm font-medium">{item.title}</p>
                    {item.body && <p className="text-sm text-muted-foreground"><AutoLinkText text={item.body} /></p>}
                    <Link href={target.href} className="text-xs underline"
                      onClick={() => {
                        if (!item.readAt) markRead.mutate({ id: item.id });
                        setOpen(false);
                      }}>
                      {target.label}
                    </Link>
                  </div>
                );
              })()
          ))}
      </PopoverContent>
    </Popover>
  );
}
