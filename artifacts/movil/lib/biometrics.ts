/**
 * Biometric helper — NATIVE (iOS / Android).
 *
 * Uses the system local-authentication API (Face ID / Touch ID / fingerprint).
 * On native there is no credential to register: enabling simply verifies the
 * user once, and the device biometry guards every later unlock. The web variant
 * (`biometrics.web.ts`) implements the same contract with WebAuthn.
 */
import * as LocalAuthentication from "expo-local-authentication";

export async function isBiometricAvailable(): Promise<boolean> {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function biometricLabel(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
      return "Face ID";
    }
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
      return "huella";
    }
    return "biometría";
  } catch {
    return "biometría";
  }
}

export async function enableBiometric(_userId: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Confirma tu identidad para activar el desbloqueo",
      cancelLabel: "Cancelar",
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Desbloquea Coordina ADG",
      cancelLabel: "Cancelar",
      disableDeviceFallback: false,
    });
    return result.success;
  } catch {
    return false;
  }
}

export async function disableBiometric(): Promise<void> {
  // No persistent credential on native — nothing to clean up.
}
