import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListChatGroupsQueryKey,
  getListNotificationsQueryKey,
  markChatRead as markChatReadRequest,
  useListChatGroups,
  useListNotifications,
} from "@workspace/api-client-react";

import { useAuth } from "@/contexts/AuthContext";
import { connectSocket } from "@/lib/socket";
import { showLocalNotification } from "@/lib/pwa";

interface BadgesContextValue {
  /** Number of notifications the user has not yet read. */
  unreadNotifications: number;
  /** Number of chats with new messages the user has not yet opened. */
  unreadChats: number;
  /** Mark a chat as read once the user opens it, clearing its badge. */
  markChatRead: (groupId: number) => void;
  /** Flag a chat as the one currently on screen so its updates are ignored. */
  setActiveChat: (groupId: number | null) => void;
}

const BadgesContext = createContext<BadgesContextValue | undefined>(undefined);

/**
 * Tracks unread counts for the tab bar badges.
 *
 * Both notification and chat unread state are derived from the cached server
 * lists, which are the source of truth. Notifications use `readAt`; chat groups
 * carry a server-computed `unreadCount` backed by a per-member "last read"
 * marker, so unread state survives reinstalls and syncs across devices.
 * Realtime "chat_update"/"notification" events simply refetch the relevant
 * list, and opening a chat persists the read marker on the server.
 */
export function BadgesProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const activeChatRef = useRef<number | null>(null);

  const setActiveChat = useCallback((groupId: number | null) => {
    activeChatRef.current = groupId;
  }, []);

  const { data: notifications } = useListNotifications({
    query: { queryKey: getListNotificationsQueryKey(), enabled: !!token },
  });
  const unreadNotifications = (notifications ?? []).filter(
    (n) => !n.readAt,
  ).length;

  const { data: chatGroups } = useListChatGroups({
    query: { queryKey: getListChatGroupsQueryKey(), enabled: !!token },
  });
  const unreadChats = (chatGroups ?? []).filter(
    (g) => (g.unreadCount ?? 0) > 0,
  ).length;

  const markChatRead = useCallback(
    (groupId: number) => {
      void markChatReadRequest(groupId)
        .catch(() => {
          // Network hiccups are non-fatal; the next list refresh reconciles.
        })
        .finally(() => {
          void queryClient.invalidateQueries({
            queryKey: getListChatGroupsQueryKey(),
          });
        });
    },
    [queryClient],
  );

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);

    const onChatUpdate = () => {
      void queryClient.invalidateQueries({
        queryKey: getListChatGroupsQueryKey(),
      });
    };

    const onNotification = (payload?: {
      title?: string;
      body?: string | null;
      type?: string | null;
    }) => {
      void queryClient.invalidateQueries({
        queryKey: getListNotificationsQueryKey(),
      });
      if (payload?.title) {
        void showLocalNotification(payload.title, payload.body, {
          type: payload.type ?? "general",
        });
      }
    };

    socket.on("chat_update", onChatUpdate);
    socket.on("notification", onNotification);
    return () => {
      socket.off("chat_update", onChatUpdate);
      socket.off("notification", onNotification);
    };
  }, [token, queryClient]);

  return (
    <BadgesContext.Provider
      value={{
        unreadNotifications,
        unreadChats,
        markChatRead,
        setActiveChat,
      }}
    >
      {children}
    </BadgesContext.Provider>
  );
}

export function useBadges(): BadgesContextValue {
  const ctx = useContext(BadgesContext);
  if (!ctx) {
    throw new Error("useBadges must be used within a BadgesProvider");
  }
  return ctx;
}
