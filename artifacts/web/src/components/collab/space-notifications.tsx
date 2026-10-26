import { useState } from "react";
import { AutoLinkText } from "@/components/auto-link-text";
import { Bell, Trash2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useDeleteNotification,
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
  const [, navigate] = useLocation();
  const client = useQueryClient();
  const queryKey = [...getListNotificationsQueryKey(), userId];
  const notices = useListNotifications({
    query: { queryKey, refetchInterval: 30_000, refetchOnMount: "always" },
  });
  const markRead = useMarkNotificationRead({
    mutation: { onSuccess: () => client.invalidateQueries({ queryKey }) },
  });
  const deleteRead = useDeleteNotification({
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
                    role="link"
                    tabIndex={0}
                    aria-label={`Abrir aviso: ${item.title}`}
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest("a, button")) return;
                      if (!item.readAt) markRead.mutate({ id: item.id });
                      setOpen(false);
                      navigate(target.href);
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
                      event.preventDefault();
                      if (!item.readAt) markRead.mutate({ id: item.id });
                      setOpen(false);
                      navigate(target.href);
                    }}
                    className={`cursor-pointer rounded-md p-3 mb-1 hover:bg-accent focus-visible:outline focus-visible:outline-2 ${!item.readAt ? "bg-accent/60" : ""}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-medium">{item.title}</p>
                      {item.readAt && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          aria-label={`Eliminar aviso leído: ${item.title}`}
                          title="Eliminar aviso leído"
                          disabled={deleteRead.isPending}
                          onClick={() => deleteRead.mutate({ id: item.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
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
