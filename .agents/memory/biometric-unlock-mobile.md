---
name: Biometric unlock (movil)
description: Cross-platform biometric app-lock model and the SecureStore-on-web gotcha it had to work around.
---

# Biometric unlock — Coordina ADG Móvil

Biometrics is a **local device lock** protecting the already-saved session, NOT a
server-verified login. Web is explicitly out of scope for backend WebAuthn
challenge/registration.

## Platform split
- Helper resolves by platform extension: `lib/biometrics.ts` (native, expo-local-authentication)
  and `lib/biometrics.web.ts` (WebAuthn platform authenticator, `userVerification: "required"`).
  Same contract: `isBiometricAvailable / biometricLabel / enableBiometric(userId) / authenticateBiometric / disableBiometric`.
- Native: no credential to store — enabling just verifies once; device biometry guards later unlocks.
- Web: `navigator.credentials.create` stores the credential id locally; challenge is generated
  client-side and never validated server-side. WebAuthn byte fields need `as BufferSource`
  casts (TS rejects `Uint8Array<ArrayBufferLike>`).

## SecureStore is a no-op on web
**`expo-secure-store`'s web module is `export default {}`** — every method is undefined and
throws. So on web the session was NOT actually persisted before this work.
**How to apply:** never call SecureStore directly for anything that must work in the PWA.
Use `lib/secureStore.ts` (SecureStore on native, `localStorage` on web, all best-effort/no-throw).

## Lock UX model (two faces, one mechanism)
- Cold start with saved session + biometric enabled → DON'T put token in memory; expose a
  `lockedSession`. Router lands on the login screen, which shows "Entrar con huella" +
  password form as fallback. This screen IS the open-lock.
- Resume (foreground after background) while signed in + enabled → `AppLock` full-screen
  overlay (biometric auto-prompt + "Usar contraseña" re-auth via stored email).
- `biometricAvailable === false` (e.g. enrolment removed) still keeps the lock: button hidden,
  password is the only way in. Sign-out fully clears session + disables biometric.
**Why:** the task asked for both a login-screen button AND a lock screen; routing-based cold
lock + overlay resume lock satisfies both without auto-entering an unlocked app.
