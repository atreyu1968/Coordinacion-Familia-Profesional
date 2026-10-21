---
name: Account audit scope
description: Privacy decisions for historical account administration events and transfers.
---

Account audit visibility requires both the historical before/after scopes and
the account's current management permissions. Receiving managers must not see
events from a previous scope or details of cross-scope transfers. Superadmins
retain global access. Historical roles must also be below the viewer's role.

**Why:** Current account membership alone would disclose another center's or
province's administrative history after a transfer.

**How to apply:** Preserve immutable scope snapshots, filter before pagination,
and never backfill invented events or rewrite older events on account changes.
Administrative actions are the scope of this history; automated transitions
and self-service profile changes must not be attributed to an administrator.
