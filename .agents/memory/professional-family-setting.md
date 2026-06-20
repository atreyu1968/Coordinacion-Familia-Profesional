---
name: Configurable professional family (familia profesional)
description: The app-instance "familia profesional" branding value — where it lives, its fallback chain, and the rule for any identity text or family-scoped default.
---

# Configurable professional family

The app instance targets one FP "familia profesional". It is a branding/identity
value (NOT per-center data), configurable from Configuración → Apariencia.

**Rule:** any user-visible identity text that names the family, and any
"default family" behavior, must derive from the configured value — never a
hardcoded "Administración y Gestión" literal.

**Why:** the same codebase is reused for other professional families; hardcoded
identity strings silently mislabel those instances (a PDF certificate footer was
the easy one to miss — it has no UI and only renders on email send).

**How to apply:**
- Server: read it via `professionalFamilyOf(settings)` (lib/settings.ts), which
  applies the `DEFAULT_PROFESSIONAL_FAMILY` fallback. Pass it into pure helpers
  (e.g. PDF generation) as an argument rather than re-importing settings there.
- Web/mobile: read `professionalFamily` from the branding context/hook
  (`useBranding` web, `useBrandingAssets` mobile), each with its own defensive
  default fallback.
- Fallback chain: DB column nullable → server default → client default, all the
  same literal. Keep them in sync.
- Behavior B: Centros pre-selects the configured family as the default filter
  ONCE (only if it exists in the facet list, after branding finishes loading),
  and the user can still switch to "Todas".
- Contract: `professionalFamily` is part of BrandingSettings (GET) and
  UpdateBrandingInput (PUT) — changing its shape requires the orval/zod codegen
  loop. BrandingSettings also carries `professionalFamilyLocked` (see
  active-family-lock.md): the family is PERMANENT once persisted.
- Collab spaces (Nextcloud) + documentation (Outline) module lists use the
  GLOBAL module catalog (`useListModules`), which IS the single family's
  curriculum — so locking the family is what guarantees they never mix
  cycles/modules from another family.
