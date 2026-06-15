---
name: expo-file-system v19 legacy API
description: SDK54's expo-file-system removed cacheDirectory/downloadAsync from the default export; use the /legacy entrypoint.
---

In Expo SDK 54, `expo-file-system` (v19) replaced the classic API with a new
`File`/`Directory`/`Paths` class-based API. The old top-level helpers
(`FileSystem.cacheDirectory`, `FileSystem.documentDirectory`,
`FileSystem.downloadAsync`, etc.) NO LONGER exist on `import * as FileSystem from "expo-file-system"`
and produce TS2339 "Property 'cacheDirectory' does not exist".

**Fix:** import the legacy surface instead:
`import * as FileSystem from "expo-file-system/legacy";`
The legacy module retains `cacheDirectory`, `downloadAsync({ headers })`, etc.

**Why:** authenticated attachment downloads in the móvil chat need a cache path +
`downloadAsync` with an Authorization header; rewriting to the new File API is
unnecessary churn when the legacy entrypoint is fully supported.

**How to apply:** any movil code touching the filesystem (downloads, temp files,
share-to-OS flows) should import from `expo-file-system/legacy` unless you
deliberately adopt the new class API.
