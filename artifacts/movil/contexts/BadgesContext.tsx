import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListChatGroupsQueryKey,
  getListNotificationsQueryKey,
  useListNotifications,
} from "@workspace/api-client-react";

import { useAuth } from "@/contexts/AuthContext";
import { connectSocket } from "@/lib/socket";

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
 * Notification counts are derived from the cached server list (`readAt` is the
 * source of truth) and refreshed when a realtime "notification" arrives. Chat
 * unread state has no server-side read tracking, so it is tracked client-side:
 * each "chat_update" socket event flags the group as unread, and opening the
 * chat clears it.
 */
export function BadgesProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [unreadChatIds, setUnreadChatIds] = useState<Set<number>>(new Set());
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

  const markChatRead = useCallback((groupId: number) => {
    setUnreadChatIds((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!token) {
      setUnreadChatIds(new Set());
      return;
    }
    const socket = connectSocket(token);

    const onChatUpdate = (payload: { groupId?: unknown }) => {
      if (typeof payload?.groupId === "number") {
        const groupId = payload.groupId;
        // Ignore updates for the chat the user is currently viewing — those
        // messages are read on arrival, so they must not raise the badge.
        if (groupId !== activeChatRef.current) {
          setUnreadChatIds((prev) => {
            const next = new Set(prev);
            next.add(groupId);
            return next;
          });
        }
      }
      void queryClient.invalidateQueries({
        queryKey: getListChatGroupsQueryKey(),
      });
    };

    const onNotification = () => {
      void queryClient.invalidateQueries({
        queryKey: getListNotificationsQueryKey(),
      });
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
        unreadChats: unreadChatIds.size,
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
