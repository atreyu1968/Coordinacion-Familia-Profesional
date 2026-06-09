import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { login as loginRequest, type User } from "@workspace/api-client-react";

import {
  authenticateBiometric,
  disableBiometric,
  enableBiometric,
  isBiometricAvailable,
} from "@/lib/biometrics";
import {
  deleteStoredItem,
  getStoredItem,
  setStoredItem,
} from "@/lib/secureStore";
import { disconnectSocket } from "@/lib/socket";

const TOKEN_KEY = "coordina_adg_token";
const USER_KEY = "coordina_adg_user";
const BIOMETRIC_KEY = "coordina_adg_biometric";

// Module-level token cache so the api-client auth getter (registered at the
// root of _layout.tsx) can read the current token before every request.
let currentToken: string | null = null;
export function getAuthToken(): string | null {
  return currentToken;
}

interface LockedSession {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** A saved session waiting for biometric unlock on the login screen. */
  hasLockedSession: boolean;
  /** True while the app is locked behind the biometric overlay (resume case). */
  locked: boolean;
  /** Whether the user enabled biometric unlock for the saved session. */
  biometricEnabled: boolean;
  /** Whether this device can actually do biometrics right now. */
  biometricAvailable: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: User) => Promise<void>;
  /** Login screen: unlock the saved session with biometrics. */
  loginWithBiometric: () => Promise<boolean>;
  /** Resume overlay: clear the lock with biometrics. */
  unlock: () => Promise<boolean>;
  /** Resume overlay: clear the lock by re-entering the password. */
  unlockWithPassword: (password: string) => Promise<boolean>;
  /** Settings: turn biometric unlock on (verifies/registers first). */
  enableBiometricUnlock: () => Promise<boolean>;
  /** Settings: turn biometric unlock off. */
  disableBiometricUnlock: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [lockedSession, setLockedSession] = useState<LockedSession | null>(null);
  const [locked, setLocked] = useState<boolean>(false);
  const [biometricEnabled, setBiometricEnabled] = useState<boolean>(false);
  const [biometricAvailable, setBiometricAvailable] = useState<boolean>(false);

  // Track app foreground/background transitions to re-lock on resume.
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser, storedBiometric, available] =
          await Promise.all([
            getStoredItem(TOKEN_KEY),
            getStoredItem(USER_KEY),
            getStoredItem(BIOMETRIC_KEY),
            isBiometricAvailable(),
          ]);

        setBiometricAvailable(available);
        const wantsBiometric = storedBiometric === "1";
        setBiometricEnabled(wantsBiometric);

        if (storedToken && storedUser) {
          const parsedUser = JSON.parse(storedUser) as User;
          if (wantsBiometric) {
            // Keep the saved session locked behind biometrics — the login
            // screen will reveal a "Entrar con huella" button.
            setLockedSession({ token: storedToken, user: parsedUser });
          } else {
            currentToken = storedToken;
            setToken(storedToken);
            setUser(parsedUser);
          }
        }
      } catch {
        // Ignore — treat as logged out.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Re-lock when the app returns to the foreground while signed in with
  // biometrics enabled.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appState.current;
      appState.current = next;
      if (
        prev.match(/inactive|background/) &&
        next === "active" &&
        currentToken &&
        biometricEnabled
      ) {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, [biometricEnabled]);

  const persistSession = useCallback(async (nextToken: string, nextUser: User) => {
    await Promise.all([
      setStoredItem(TOKEN_KEY, nextToken),
      setStoredItem(USER_KEY, JSON.stringify(nextUser)),
    ]);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await loginRequest({ email, password });
      currentToken = result.token;
      setToken(result.token);
      setUser(result.user);
      setLockedSession(null);
      setLocked(false);
      await persistSession(result.token, result.user);
    },
    [persistSession],
  );

  const updateUser = useCallback(async (next: User) => {
    setUser(next);
    setLockedSession((prev) => (prev ? { ...prev, user: next } : prev));
    await setStoredItem(USER_KEY, JSON.stringify(next));
  }, []);

  const signOut = useCallback(async () => {
    currentToken = null;
    disconnectSocket();
    setToken(null);
    setUser(null);
    setLockedSession(null);
    setLocked(false);
    setBiometricEnabled(false);
    await disableBiometric();
    await Promise.all([
      deleteStoredItem(TOKEN_KEY),
      deleteStoredItem(USER_KEY),
      deleteStoredItem(BIOMETRIC_KEY),
    ]);
  }, []);

  const loginWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!lockedSession) return false;
    const ok = await authenticateBiometric();
    if (!ok) return false;
    currentToken = lockedSession.token;
    setToken(lockedSession.token);
    setUser(lockedSession.user);
    setLockedSession(null);
    setLocked(false);
    return true;
  }, [lockedSession]);

  const unlock = useCallback(async (): Promise<boolean> => {
    const ok = await authenticateBiometric();
    if (ok) setLocked(false);
    return ok;
  }, []);

  const unlockWithPassword = useCallback(
    async (password: string): Promise<boolean> => {
      if (!user?.email) return false;
      try {
        const result = await loginRequest({ email: user.email, password });
        currentToken = result.token;
        setToken(result.token);
        setUser(result.user);
        setLocked(false);
        await persistSession(result.token, result.user);
        return true;
      } catch {
        return false;
      }
    },
    [user, persistSession],
  );

  const enableBiometricUnlock = useCallback(async (): Promise<boolean> => {
    if (!user) return false;
    const ok = await enableBiometric(String(user.id));
    if (!ok) return false;
    setBiometricEnabled(true);
    await setStoredItem(BIOMETRIC_KEY, "1");
    return true;
  }, [user]);

  const disableBiometricUnlock = useCallback(async (): Promise<void> => {
    setBiometricEnabled(false);
    await disableBiometric();
    await deleteStoredItem(BIOMETRIC_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        hasLockedSession: !!lockedSession,
        locked,
        biometricEnabled,
        biometricAvailable,
        signIn,
        signOut,
        updateUser,
        loginWithBiometric,
        unlock,
        unlockWithPassword,
        enableBiometricUnlock,
        disableBiometricUnlock,
      }}
    >
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
