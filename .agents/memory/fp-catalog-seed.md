---
name: FP cycles + modules national catalog seed
description: Where the cycles/modules reference catalog comes from and the non-obvious dedup gotcha when regenerating it.
---

# FP catalog (ciclos formativos + módulos)

The national catalog of FP cycles and their modules is seeded from
**todofp.es Grados D** (grado-medio / grado-superior / fp-grado-basico index
pages → ~191 cycle detail pages). Output lives as committed JSON in
`scripts/src/data/cycles.json` + `modules.json`, consumed by the same
idempotent `seed-reference-data.ts` transaction as provinces/centers.

Key facts:
- Modules are seeded as **global catalog** rows: `centerId = null`, with
  `cycleId` + `cycleName` set. `academics.ts` treats `centerId IS NULL` as
  globally visible.
- Upsert keys: cycles by `(name, level)`; modules by `(cycleId, name,
  centerId IS NULL)`. JSON serial ids are source-only; FK resolved via a
  srcId→realId map.
- Cycle level is derived from the **source grade index page**, not parsed from
  the detail page.

**Why / gotcha — cross-family duplication:** some cycles are cross-listed under
multiple professional families, so the scraper sees the *same* cycle (same
name+level → same resolved cycleId) on two detail pages, each with its own
module list. Deduping modules per-page is NOT enough — you get duplicate
`(cycleId, name)` pairs (~121 of them). **Dedupe by resolved cycleId across the
whole run**, keyed on lowercased module name. The seed's upsert absorbs dups
anyway (no DB duplication), but the JSON should be clean.

**Parsing notes:** modules are the `<li class="ta-justify">` items inside the
`Plan de formación` `<h2>` accordion (NOT "Qué voy a aprender"), bounded by the
next `<h2>`. Exclude li's starting with "Incluye una fase" (FCT) and containing
"competencia de cada Comunidad" (optativo placeholder). Some modules are
prefixed `NNNN. Name` (official code); most center-specific ones have no code.
Drop stray non-cycle pages whose name isn't `Técnico…` / `Título Profesional
Básico…` (e.g. "Currículos de las Comunidades Autónomas").

Dev DB may contain old manual/test cycle rows (e.g. "…(Test <ts>)", level
null) with 0 modules — those are pre-existing pollution, not from this seed; a
fresh install gets exactly the scraped set (181 cycles / 2704 modules as of
2026-06).
