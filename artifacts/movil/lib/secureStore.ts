/**
 * Cross-platform key/value persistence.
 *
 * On native we use `expo-secure-store` (Keychain / Keystore). On web the native
 * SecureStore module is a no-op, so we fall back to `localStorage` — good enough
 * for the PWA, where biometrics act only as a *local device lock* protecting an
 * already-saved session (see the biometrics helper for the security model).
 *
 * All functions degrade gracefully: a storage failure resolves to `null` / a
 * no-op rather than throwing, so callers can treat persistence as best-effort.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

function isWeb(): boolean {
  return Platform.OS === "web";
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export async function getStoredItem(key: string): Promise<string | null> {
  try {
    if (isWeb()) {
      return hasLocalStorage() ? window.localStorage.getItem(key) : null;
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setStoredItem(key: string, value: string): Promise<void> {
  try {
    if (isWeb()) {
      if (hasLocalStorage()) window.localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch {
    // Best-effort: ignore persistence failures.
  }
}

export async function deleteStoredItem(key: string): Promise<void> {
  try {
    if (isWeb()) {
      if (hasLocalStorage()) window.localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Best-effort: ignore.
  }
}
