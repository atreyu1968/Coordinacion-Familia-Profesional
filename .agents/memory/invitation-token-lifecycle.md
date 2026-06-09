---
name: Invitation token lifecycle
description: Single-use invitation tokens — creation by role only, renew guards, and atomic consumption at registration.
---

# Invitation token lifecycle

Invitation codes are generated from **role (+ optional province/center scope) only** — the
invitee's email is unknown at creation. The recipient supplies their own email at registration,
which is then recorded on the invitation row when the token is consumed.

## Rules that must hold

- **Renew/resend** (`POST /invitations/:id/resend`) must reject `used` and `revoked`
  invitations with 409. Only `pending` (or expired-but-pending) may be reactivated.
  **Why:** without a status guard, renewing a consumed token makes it reusable, breaking
  single-use semantics.
- **Registration consumption must be atomic.** Wrap the select-check-insert-mark flow in a
  DB transaction and lock the invitation row with `.for("update")` (`SELECT ... FOR UPDATE`).
  **Why:** concurrent registrations can otherwise consume the same single-use token (TOCTOU
  on status and email uniqueness).
  **How to apply:** inside `db.transaction`, throw a typed error for 400 cases and translate
  it to the HTTP response outside the transaction.
