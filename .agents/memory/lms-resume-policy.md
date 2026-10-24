---
name: LMS resume policy
description: Reading-position synchronization choices that protect unsent lesson work.
---

Restore the server reading position when entering a course, but do not move an already open lesson when background progress refreshes arrive. Reading position never implies completion.

**Why:** switching a learner's active quiz after another device saves a position could discard unsent answers. Background freshness and automatic navigation are different concerns.

**How to apply:** refresh before choosing the initial lesson; retain the active selection during progress updates. Preview navigation is a local simulation and must never read or overwrite the learner's real resume point.

The latest server-accepted position wins; device wall-clock timestamps are not authoritative.

**Why:** phone and desktop clocks may disagree. Serializing a client's pending writes prevents its own slower earlier request from winning.

**How to apply:** keep reading-position writes separate from completion/attempt mutations and preserve per-client request order. Navigation or preview entry must not cancel accepted selections waiting behind a slow save; drain them before reloading the resume target. Pin each queued request to its initiating identity so signing out cannot transfer that selection to another account.
