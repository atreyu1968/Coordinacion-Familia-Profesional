---
name: Tailwind v4 remote font imports
description: Why web fonts must be loaded via <link> not CSS @import in Tailwind v4 projects
---

Load remote web fonts (Google Fonts etc.) with a `<link rel="stylesheet">` tag in `index.html`, NOT with `@import url('https://fonts...')` in a CSS file.

**Why:** Tailwind v4's Vite plugin inlines `@import "tailwindcss"` into thousands of lines of CSS during processing. Any `@import url(...)` for a remote font gets reordered to AFTER that inlined block, violating the CSS rule "@import must precede all other statements." PostCSS then errors and CSS fails to apply, leaving the app unstyled / not rendering. Moving the font `@import` to the top of the CSS file does NOT reliably fix it because the plugin still reorders.

**How to apply:** When adding a web font to a Tailwind v4 + Vite app, add it to `index.html` `<head>` alongside existing font links and reference the family in your CSS `font-family` / theme tokens. Keep CSS files free of remote `@import url()`.
