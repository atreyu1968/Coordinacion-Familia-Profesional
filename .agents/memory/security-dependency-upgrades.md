---
name: Security dependency upgrades
description: Non-obvious generator compatibility and advisory interpretation during dependency maintenance
---

## Generator detection in a catalog-based workspace
Keep Orval's generated API targets explicitly aligned with the application's existing Zod and React Query major versions.

**Why:** newer Orval releases can fail to detect packages declared through this monorepo's pnpm catalog. The fallback can produce Zod 4 and React Query 4 output even though the application uses Zod 3 and React Query 5. A generator security update must not silently migrate those application frameworks.

**How to apply:** check output target configuration when updating the generator, regenerate both clients and validators, then typecheck the generated libraries and their consumers. Generated fetch code may also need DOM iterable typings.

## SheetJS advisories can overmatch corrected official releases
Use the official SheetJS distribution and verify the resolved version against the advisory's actual fixed version; do not downgrade to the obsolete npm release just because a scanner still flags the package.

**Why:** the audit metadata for CVE-2023-30533 and CVE-2024-22363 marks an open-ended npm range. It still reports the official 0.20.3 tarball, although the descriptions state fixes in 0.19.3 and 0.20.2 respectively. The official documentation identifies its CDN, not npm's old 0.18.5, as authoritative.

**How to apply:** document these specific scanner discrepancies without disabling or globally suppressing audits. Check the installed version, official advisories, and Excel export compatibility. Reassess if versions or advisory metadata change.

Official sources:
- https://docs.sheetjs.com/docs/getting-started/installation/nodejs/
- https://cdn.sheetjs.com/advisories/CVE-2023-30533
- https://cdn.sheetjs.com/advisories/CVE-2024-22363
