---
name: Móvil web side strips (WebMobileFrame)
description: Why light/white strips appear beside the blue header on the móvil PWA — it's the desktop frame, not safe-area insets.
---

# Light strips on the sides of the móvil header (web/PWA)

If a user reports white/light strips on the LEFT and RIGHT of the blue header
(or the whole app) on their phone, the cause is almost certainly
`WebMobileFrame` in `app/_layout.tsx`, NOT safe-area insets / `viewport-fit`.

**What it does:** on web it centers the app in a `maxWidth: 440` frame over a
`colors.muted` (light gray) backdrop with hairline left/right borders. This is
intended ONLY for wide desktop browsers (so the app doesn't stretch edge-to-edge
like a desktop site).

**Why it looks like a "header" problem:** the muted backdrop runs the full height
on both sides. The body background is cream (`colors.background`) so the strips
blend in there, but against the BLUE header they stand out — so the user
perceives it as strips beside the header only.

**Fix / rule:** gate the centered frame on viewport width. Render children
edge-to-edge when `useWindowDimensions().width < 600` (real phones / installed
PWA); only apply the centered phone-width frame on wide desktop. Phones report
CSS widths ~360–430, well under 600.

**Why:** safe-area / `viewport-fit=cover` fixes the TOP/BOTTOM (status bar, home
indicator, tab bar) but never the left/right strips — those came entirely from
the desktop frame. Don't chase safe-area for horizontal strips on mobile.
