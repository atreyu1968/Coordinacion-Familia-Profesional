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

## Returning from links opened by the app
Keep the session unlocked for the handoff back from an external link opened by the app, but
retain biometric re-locking for ordinary app background/resume and clear any pending exception
on sign-out or when biometrics are disabled.
**Why:** the user explicitly approved this narrow exception after the app asked for biometrics
when returning from a new browser tab; disabling the biometric lock globally would be broader
than requested.
**How to apply:** open outbound web links through the tracked browser-link path; avoid bypassing
that tracking with direct browser navigation for ordinary external links.

## Classroom tabs from an unlocked PWA
An internal course opened in another tab must inherit the already-unlocked
session for that specific opening; it must not be treated as an unrelated cold
start. Keep any handoff one-use, short-lived, and bound to the exact course path.
Never put session tokens in URLs or disable biometric locking globally.
**Why:** opening a separate classroom otherwise sends biometric-enabled users
back through login and loses the course destination.
**How to apply:** exercise new-tab course tests with biometrics enabled, not
only ordinary password-login fixtures. Preserve the destination across any
genuinely required login.
