---
name: Forum moderation history
description: Privacy and classification rules for the forum action audit trail
---

Forum moderation history is metadata-only: preserve the actor identity/name, module, action, and timestamp, but never store or return deleted post or thread text. Record pins/unpins and moderator-driven deletions; ordinary participant self-deletions are not moderation events. Reading the history follows the module's moderation authorization.

**Why:** The audit trail should help resolve moderation questions without becoming a way to recover deleted content or mislabel participant actions as moderator behavior.

**How to apply:** Keep any new forum audit events content-free, classify actions based on whether they were performed in a moderation capacity, and enforce the existing module-level moderation access checks on reads.
