import { useState } from "react";
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

/** Membership notices remain informational; only the open endpoint grants access. */
export function SpaceNotifications({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  const client = useQueryClient();
  const queryKey = [...getListNotificationsQueryKey(), userId];
  const notices = useListNotifications({
    query: { queryKey, refetchInterval: 30_000, refetchOnMount: "always" },
  });
  const markRead = useMarkNotificationRead({
    mutation: { onSuccess: () => client.invalidateQueries({ queryKey }) },
  });
  const items = (notices.data ?? []).filter((item) => item.type === "collaborative_space");
  const unread = items.filter((item) => !item.readAt).length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-sidebar-foreground hover:bg-sidebar-accent"
          aria-label={`Avisos de espacios colaborativos${unread ? `: ${unread} sin leer` : ""}`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-0 top-0 rounded-full bg-destructive px-1 text-[10px] text-white">{unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <h2 className="font-semibold mb-3">Espacios colaborativos</h2>
        {notices.isLoading ? <p className="text-sm">Cargando avisos…</p>
          : notices.isError ? <div className="text-sm">No se pudieron cargar los avisos. <Button variant="link" onClick={() => void notices.refetch()}>Reintentar</Button></div>
          : items.length === 0 ? <p className="text-sm text-muted-foreground">No tienes avisos de nuevos espacios.</p>
          : items.map((item) => (
            <Link key={item.id} href="/espacio"
              className={`block rounded-md p-3 mb-1 hover:bg-accent ${!item.readAt ? "bg-accent/60" : ""}`}
              onClick={() => {
                if (!item.readAt) markRead.mutate({ id: item.id });
                setOpen(false);
              }}>
              <p className="text-sm font-medium">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.body}</p>
              <span className="text-xs underline">Ir a Espacio colaborativo</span>
            </Link>
          ))}
      </PopoverContent>
    </Popover>
  );
}
