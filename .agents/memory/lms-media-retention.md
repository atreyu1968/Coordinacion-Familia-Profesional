---
name: LMS media retention
description: Why removing a course cover does not immediately destroy the old stored bytes.
---

Do not immediately delete previously referenced course media when replacing or removing a cover. Use reference-aware, delayed cleanup rather than deleting bytes in the course update request.

**Why:** A concurrent ZIP export may already have read the old media reference and still need to download its bytes. Immediate deletion can turn a valid export into a missing-file failure. Removing the cover still revokes access through its course endpoint immediately.

**How to apply:** Any future cleanup should account for in-flight exports, currently referenced media and outstanding uploads; it must not grant public access to retained private files.

Private browser images must be fetched through the authenticated API client before assigning a temporary blob URL to an image element.

**Why:** Generic shared-client documentation mentions browser cookie authentication, but this application's middleware requires a bearer header. A direct image URL silently receives 401 even in a signed-in browser.

**How to apply:** Check the actual authentication middleware rather than relying on shared-client comments. For private media, verify the authenticated request as well as the rendered image source, and revoke temporary URLs on replacement and unmount.
