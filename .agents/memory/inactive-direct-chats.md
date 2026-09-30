---
name: Inactive direct chats
description: Retention behavior for direct conversations when an account becomes inactive.
---

Hide direct conversations with inactive or deleted counterpart accounts from inboxes and deny access through message APIs, but do not explicitly delete their conversation history.

**Why:** Account deactivation should stop access without silently destroying historical records.

**How to apply:** Enforce the inactive-account check both when listing direct chats and when authorizing chat operations. Keep group cleanup behavior separate.