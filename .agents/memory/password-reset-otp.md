---
name: Password reset OTP flow
description: How email-based password recovery works and the single-use atomicity constraint
---

# Password reset (email OTP)

Flow: `POST /auth/forgot-password` (email) emails a 6-digit OTP; `POST /auth/reset-password` (email + code + newPassword) sets the new password. Table `password_reset_tokens` stores only the **bcrypt hash** of the code (never plaintext), 15-min TTL, `attempts` cap 5, `usedAt` for single-use.

- forgot-password **always** returns `{ok:true}` (no user enumeration) and invalidates prior unused codes before issuing a new one.
- Email is delivered through the existing `sendEmail` (Resend) which reads config from the **in-app settings panel** (`getSettings`/`isResendConfigured`), NOT env vars. When unconfigured it no-ops gracefully (`{sent:false, pending:true}`) and never throws — so the reset flow still succeeds end-to-end without email configured.

**Rule — single-use must be atomic.** Consume the token with a conditional update `WHERE id = ? AND used_at IS NULL` and check `.returning()` is non-empty *before* writing the new password.
**Why:** a read-then-write (verify code, then mark used) lets two concurrent valid submissions both pass verification, resetting the password twice for one OTP. The conditional update makes exactly one request win.
**How to apply:** any single-use token consumption (invites, OTPs) in this codebase should claim the row conditionally, not via a plain `WHERE id = ?` update after a separate read.

**Known follow-up (not implemented):** no IP/global rate limiting on either endpoint — only the per-token 5-attempt cap exists. Brute-force hardening (throttle forgot-password + reset-password) is a candidate enhancement; would need a rate-limit middleware (none exists in api-server yet).
