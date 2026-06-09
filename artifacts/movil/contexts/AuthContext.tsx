import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import * as SecureStore from "expo-secure-store";

import { login as loginRequest, type User } from "@workspace/api-client-react";

import { disconnectSocket } from "@/lib/socket";

const TOKEN_KEY = "coordina_adg_token";
const USER_KEY = "coordina_adg_user";

// Module-level token cache so the api-client auth getter (registered at the
// root of _layout.tsx) can read the current token before every request.
let currentToken: string | null = null;
export function getAuthToken(): string | null {
  return currentToken;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (storedToken) {
          currentToken = storedToken;
          setToken(storedToken);
        }
        if (storedUser) {
          setUser(JSON.parse(storedUser) as User);
        }
      } catch {
        // Ignore — treat as logged out.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await loginRequest({ email, password });
    currentToken = result.token;
    setToken(result.token);
    setUser(result.user);
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, result.token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(result.user)),
    ]);
  }, []);

  const signOut = useCallback(async () => {
    currentToken = null;
    disconnectSocket();
    setToken(null);
    setUser(null);
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
