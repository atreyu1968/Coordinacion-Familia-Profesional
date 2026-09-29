---
name: JSZip stream compatibility
description: Runtime behavior and safe consumption of JSZip entry streams.
---

# JSZip stream compatibility

**Rule:** Do not assume a JSZip entry's `nodeStream()` supports async iteration. Its compatibility stream may expose only Node-style `data`, `end`, and `error` events. Enforce byte limits while consuming chunks.

**Why:** In this runtime the stream did not implement `Symbol.asyncIterator`. Since per-entry parsing catches stream errors, `for await` silently skipped Office and ZIP text rather than failing the indexing job.

**How to apply:** When changing ZIP/Office extraction or upgrading JSZip, test real archives and oversized entries; verify extracted text and bounded failure behavior.