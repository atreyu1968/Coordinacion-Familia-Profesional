import { createContext, useContext } from "react";
import type { User } from "@workspace/api-client-react";

export interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
}

// Kept in its own module (no React components) so the context identity stays
// stable across Vite HMR updates. If it lived alongside <AuthProvider>, a hot
// update would create a new context object while the mounted provider kept the
// old one, making useAuth throw "must be used within an AuthProvider".
export const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
