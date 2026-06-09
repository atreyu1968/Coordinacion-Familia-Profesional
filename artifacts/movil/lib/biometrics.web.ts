/**
 * Biometric helper — WEB / PWA.
 *
 * Implements the same contract as the native helper using WebAuthn's platform
 * authenticator with `userVerification: "required"`. This is a *local device
 * lock*, not a server-verified login: we generate the challenge client-side and
 * never validate the assertion on the backend. Its only job is to gate access to
 * the session that is already saved on this device (see the task scope).
 *
 * The credential id is stored locally so we can target the same authenticator on
 * unlock; if it is ever lost, we fall back to a discoverable-credential prompt.
 */
const CRED_KEY = "coordina_adg_webauthn_cred";

function available(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    !!navigator.credentials
  );
}

function randomChallenge(): BufferSource {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes as BufferSource;
}

function bufToBase64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBuf(value: string): BufferSource {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes as BufferSource;
}

export async function isBiometricAvailable(): Promise<boolean> {
  if (!available()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function biometricLabel(): Promise<string> {
  return "huella / Face ID";
}

export async function enableBiometric(userId: string): Promise<boolean> {
  if (!available()) return false;
  try {
    const idBytes = new TextEncoder().encode(userId || "coordina-adg-user");
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "Coordina ADG" },
        user: {
          id: idBytes as BufferSource,
          name: "Coordina ADG",
          displayName: "Coordina ADG",
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;
    if (!credential) return false;
    try {
      window.localStorage.setItem(CRED_KEY, bufToBase64url(credential.rawId));
    } catch {
      // The enable still succeeded; we simply lose the targeted id.
    }
    return true;
  } catch {
    return false;
  }
}

export async function authenticateBiometric(): Promise<boolean> {
  if (!available()) return false;
  try {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(CRED_KEY);
    } catch {
      stored = null;
    }
    const allowCredentials: PublicKeyCredentialDescriptor[] | undefined = stored
      ? [{ type: "public-key", id: base64urlToBuf(stored) }]
      : undefined;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials,
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

export async function disableBiometric(): Promise<void> {
  try {
    window.localStorage.removeItem(CRED_KEY);
  } catch {
    // Best-effort.
  }
}
