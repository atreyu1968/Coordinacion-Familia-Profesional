---
name: API Server dev needs restart for new routes
description: Why newly added Express routes return 404 until the workflow is restarted.
---

# New API routes require a workflow restart

The `artifacts/api-server` dev script is `build && start` (esbuild bundle → `node dist/index.mjs`), **not** a watch/hot-reload setup. Newly added or newly mounted routes return `Cannot <METHOD> /api/...` (Express 404 HTML) until the `artifacts/api-server: API Server` workflow is restarted.

**Why:** A running server keeps serving the previously bundled `dist`. Editing route files does not rebuild or reload automatically.

**How to apply:** After adding/mounting a route (or any backend code change), restart the API Server workflow before smoke-testing. A 404 on a route you just wrote is almost always a stale server, not a routing bug.
