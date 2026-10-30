import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  setUnauthorizedHandler,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  type User,
} from "@workspace/api-client-react";
import { AuthContext } from "./auth-context";
import { connectSocket, disconnectSocket } from "./socket";

// Re-exported for backward compatibility so existing `@/lib/auth` imports keep
// working. The hook + context now live in auth-context.ts to stay HMR-stable.
export { useAuth } from "./auth-context";

const TOKEN_KEY = "coordina_adg_token";
export const AUTH_SESSION_NOTICE_KEY = "coordina_adg_session_notice";

// Set up the getter immediately so the API client has it
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

function noticeForSessionFailure(code?: string): string | null {
  if (code === "APP_UPDATED") {
    return "La aplicación se ha actualizado. Inicia sesión de nuevo para continuar.";
  }
  if (code === "SESSION_REVOKED") {
    return "Tu sesión se ha cerrado. Inicia sesión de nuevo para continuar.";
  }
  return null;
}

function normalizeSessionNotice(value: unknown): string | null {
  if (typeof value === "string") {
    const message = value.trim();
    return message && message !== "[object Object]" ? message : null;
  }
  if (!value || typeof value !== "object") return null;

  const record = value as { message?: unknown; description?: unknown; code?: unknown };
  for (const candidate of [record.message, record.description]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return typeof record.code === "string" ? noticeForSessionFailure(record.code) : null;
}

export function getStoredAuthSessionNotice(): string | null {
  const stored = localStorage.getItem(AUTH_SESSION_NOTICE_KEY);
  if (stored == null) return null;

  let value: unknown = stored;
  try {
    value = JSON.parse(stored);
  } catch {
    // Ignore malformed legacy values instead of rendering "[object Object]".
  }
  const message = normalizeSessionNotice(value);
  if (message) return message;
  localStorage.removeItem(AUTH_SESSION_NOTICE_KEY);
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const currentUserQueryKey = getGetCurrentUserQueryKey();

  const { data: user, isLoading: isUserLoading, error } = useGetCurrentUser({
    query: {
      queryKey: currentUserQueryKey,
      enabled: !!token,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchInterval: 30_000,
    }
  });

  const clearSessionData = useCallback(() => {
    // cancelQueries starts cancellation synchronously; clear() removes both
    // cached user data and mutation state before a different identity renders.
    void queryClient.cancelQueries();
    queryClient.clear();
    disconnectSocket();
  }, [queryClient]);

  useEffect(() => {
    if (!token) return;
    const socket = connectSocket(token);
    const refresh = () => { void queryClient.invalidateQueries(); };
    socket.on("teaching_profile:updated", refresh);
    socket.on("connect", refresh);
    return () => {
      socket.off("teaching_profile:updated", refresh);
      socket.off("connect", refresh);
    };
  }, [token, queryClient]);

  const logout = useCallback((notice?: unknown) => {
    const message = normalizeSessionNotice(notice);
    if (message) localStorage.setItem(AUTH_SESSION_NOTICE_KEY, message);
    else localStorage.removeItem(AUTH_SESSION_NOTICE_KEY);
    clearSessionData();
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setLocation("/login");
  }, [clearSessionData, setLocation]);

  useEffect(() => {
    setUnauthorizedHandler(({ code }) => {
      const notice = noticeForSessionFailure(code);
      if (notice) logout(notice);
    });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  useEffect(() => {
    if (error && (error as any)?.status === 401) {
      const code = (error as any)?.data?.code;
      logout(noticeForSessionFailure(code));
    }
  }, [error]);

  useEffect(() => {
    const syncSessionFromStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      const nextToken = localStorage.getItem(TOKEN_KEY);
      if (nextToken === token) return;
      clearSessionData();
      setToken(nextToken);
      if (!nextToken) setLocation("/login");
    };
    window.addEventListener("storage", syncSessionFromStorage);
    return () => window.removeEventListener("storage", syncSessionFromStorage);
  }, [token, queryClient, setLocation]);

  const login = (newToken: string, newUser: User) => {
    clearSessionData();
    localStorage.removeItem(AUTH_SESSION_NOTICE_KEY);
    localStorage.setItem(TOKEN_KEY, newToken);
    queryClient.setQueryData(currentUserQueryKey, newUser);
    setToken(newToken);
    void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
  };

  const isLoading = isUserLoading && !!token;

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
