import React, { useEffect, useState } from "react";
import { useLocation } from "wouter";
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

  const { data: user, isLoading: isUserLoading, error } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      enabled: !!token,
      retry: false,
    }
  });

  useEffect(() => {
    if (error && (error as any)?.status === 401) {
      logout();
    }
  }, [error]);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setLocation("/login");
  };

  const isLoading = isUserLoading && !!token;

  return (
    <AuthContext.Provider value={{ user: user || null, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
