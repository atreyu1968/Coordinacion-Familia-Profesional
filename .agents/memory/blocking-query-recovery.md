---
name: Blocking query recovery
description: Avoiding error/refetch loops when a mandatory profile gate shares a query with its recovery screen.
---

Keep the navigator mounted while compulsory profile checks are pending or failing. Block interaction with an opaque overlay and provide an explicit retry/error state instead of removing the recovery screen.

**Why:** Persistent HTTP 503 fault injection exposed a rapid request loop: a shared query's pending state unmounted the navigator, then mounting the recovery screen retried its cached error. TanStack Query uses `retryOnMount` for failed queries without data; disabling `retry` and `refetchOnMount` alone does not prevent this.

**How to apply:** Disable automatic failed-query mount retries for both observers of a blocking query, keep navigation mounted, and make retry explicit. Verify a persistent failure, bounded idle request count, and recovery after retry—not just a successful save. Preserve fail-closed access while offering a way to retry or sign out.

Keep the original protected destination separate from an intermediate mandatory-profile route, including validated notice identifiers in the query.

**Why:** An expired session can fail the profile query and force profile recovery before the user signs out. Treating that intermediate screen as the intended destination loses the notice after login.

**How to apply:** Preserve intent before forcing recovery, retain it through a rejected password, and restore it only through the normal profile and resource authorization checks. A completed profile can resume the original destination; an incomplete one must still block access.
