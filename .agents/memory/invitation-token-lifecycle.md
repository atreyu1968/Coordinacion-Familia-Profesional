---
name: Invitation token lifecycle
description: Role-scoped shared invitation links — configurable registration limits, renew guards, and atomic consumption.
---

# Invitation token lifecycle

Invitation codes are generated from **role (+ optional province/center scope) only** — the
invitees' emails are unknown at creation. Each recipient supplies their own email at registration.
Legacy and omitted limits remain single-use; a creator can choose a finite limit or an unlimited
shared link for mass email. A shared link has no representative recipient email.

## Rules that must hold

- **Renew/resend** must reject `used` and `revoked` invitations; only `pending`
  (including expired-but-pending) may have its expiry extended. Guard the update itself,
  not just a prior read.
  **Why:** a concurrent final registration could exhaust a link after the renewal read
  and before the update, accidentally reopening it.
- **Registration consumption must be atomic.** Wrap the select-check-insert-count flow in a
  DB transaction and lock the invitation row with `.for("update")` (`SELECT ... FOR UPDATE`).
  **Why:** concurrent registrations can otherwise exceed a finite limit (TOCTOU on
  remaining places and email uniqueness).
  **How to apply:** inside `db.transaction`, throw a typed error for 400 cases and translate
  it to the HTTP response outside the transaction.
- **Unlimited links must remain revocable and time-limited.**
  **Why:** a forwarded mass-mail link can grant its role to anyone with the URL; the
  registration flow does not verify ownership of the supplied email address.
  **How to apply:** surface that risk when creating the link, and never treat an
  unlimited invitation as a private recipient-specific token.
