---
name: Inactive direct chats
description: Retention behavior for direct conversations when an account becomes inactive.
---

Hide direct conversations with inactive or deleted counterpart accounts from inboxes and deny access through message APIs, but do not explicitly delete their conversation history.

**Why:** Account deactivation should stop access without silently destroying historical records.

**How to apply:** Enforce the inactive-account check both when listing direct chats and when authorizing chat operations. Keep group cleanup behavior separate.

## Messaging directory versus administrative scope

Active registered users must be discoverable for direct messaging across centers and provinces. Only expose their ID, display name and role through the messaging directory; keep the administrative user directory scoped.

**Why:** Direct conversations already allow active counterparts across scopes. Reusing the administrative directory hides valid recipients, whereas relaxing that directory would reveal unnecessary personal and management data.

**How to apply:** Web and mobile message composition must use the minimal messaging directory, excluding the caller, disabled accounts and deleted accounts. Do not widen administrative permissions to fix contact discovery.