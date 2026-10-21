---
name: Independent collaborative spaces
description: Manual membership, stable remote identity and fail-closed removal for spaces unrelated to modules.
---

The user requested administrator-created collaborative spaces independent of
modules, with participants selected manually from users or centers.

**Why:** cross-center working groups must not require teaching assignments or
grant access to unrelated parts of the application.

**How to apply:** superadministrators manage these spaces; ordinary users need
explicit membership. Module memberships and their existing folders stay separate.

Selecting centers takes a snapshot of their current active users. It is not a
dynamic rule admitting all future arrivals or changing membership when a teacher
moves center.

**Why:** manual enrollment must not unexpectedly grant access later.

**How to apply:** resolve and deduplicate users on the server at each explicit
addition. A future request for automatic enrollment is a separate product change.

Remote folder identity must remain stable when a space is renamed. Removing a
participant must revoke the remote group permission before confirming local
removal; never delete the account or shared files.

**Why:** renaming by creating a new remote folder strands existing documents.
Partial external provisioning can grant access even when the request later fails,
so an unsuccessful first open must not be treated as proof of no remote access.

**How to apply:** preserve a conservative indication that remote provisioning
may have started, serialize opening/removal, and fail visibly if remote revocation
cannot be confirmed. Recheck membership when redeeming a one-use SSO ticket.

Membership notices are best-effort after the membership commits, not a reason to
undo an enrollment. Resubmitting an already-applied selection must not resend a
notice, even if its earlier delivery failed.

**Why:** the user explicitly requires enrollment to survive notification problems
and repeated administrator selections not to produce duplicate notices.

**How to apply:** derive recipients from actual new memberships, not the requested
selection. If reliable eventual delivery is later needed, use a separate delivery
retry mechanism rather than replaying enrollment. A notice must never act as an
access grant after removal.
