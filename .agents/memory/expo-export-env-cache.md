---
name: Expo export environment cache
description: Metro can reuse a previously inlined EXPO_PUBLIC API origin across isolated web exports.
---

An isolated Expo web export needs its own Metro cache, not just a new output
directory. Use a private `TMPDIR` and clear the export cache when compiling
per-run `EXPO_PUBLIC_*` values.

**Why:** A second isolated UI run loaded its new mobile page successfully but
sent every API request to the previous run's closed loopback port. Metro reused
the inlined domain despite the new environment variable. This can look like
incorrect credentials rather than a build/cache failure.

**How to apply:** Keep temporary build caches with the disposable test resources.
Block browser network requests outside the current isolated origin as a second
boundary, so a stale compiled URL can never reach a shared API.
