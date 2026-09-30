import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  setAuthTokenGetter,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  type User,
} from "@workspace/api-client-react";
import { AuthContext } from "./auth-context";

// Re-exported for backward compatibility so existing `@/lib/auth` imports keep
// working. The hook + context now live in auth-context.ts to stay HMR-stable.
export { useAuth } from "./auth-context";

const TOKEN_KEY = "coordina_adg_token";

// Set up the getter immediately so the API client has it
setAuthTokenGetter(() => localStorage.getItem(TOKEN_KEY));

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
    }
  });

  const clearSessionData = () => {
    // cancelQueries starts cancellation synchronously; clear() removes both
    // cached user data and mutation state before a different identity renders.
    void queryClient.cancelQueries();
    queryClient.clear();
  };

  const logout = () => {
    clearSessionData();
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setLocation("/login");
  };

  useEffect(() => {
    if (error && (error as any)?.status === 401) {
      logout();
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
