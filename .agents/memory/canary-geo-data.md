---
name: Canary Islands geographic + FP centers reference data
description: How provinces/islands/municipalities and the official FP center directory are preloaded on install/update.
---

# Canary geo + FP centers reference data

Reference tables (`provinces`, `islands`, `municipalities`, `centers`) are
preloaded by an idempotent seed (`@workspace/scripts run seed-reference-data`)
from exported JSON in `scripts/src/data/`. The seed is wired into
`scripts/post-merge.sh`, `deploy/install.sh` and `deploy/update.sh` (after the db
push), so a fresh install AND later updates converge to the full dataset. Geo is
also exposed read-only via `/api/provinces|islands|municipalities` (geo.ts).

Canonical structure (88 municipalities total):
- Santa Cruz de Tenerife (TF): Tenerife 31, La Palma 14, La Gomera 6, El Hierro 3
- Las Palmas (GC): Gran Canaria 21, Lanzarote 7, Fuerteventura 6
- 155 official FP centers (each with nature, centerType, families). The 8 old
  dev/test centers are excluded from the seed (they had null nature).

**Seed matching (why it survives updates):** it never trusts the serial ids in
the JSON (they would collide with app-created rows). It upserts by stable
business keys — provinces by `code`, islands by (provinceId,name), municipalities
by (islandId,name), centers by `code` — and resolves each FK to the real parent
id in the target DB. Existing centers are only backfilled (nature/centerType/
families) when those are still empty, so admin edits are preserved. Whole run is
one transaction.

**Why this matters:** if a feature needs a complete list, the data now ships in
the repo; do not hand-INSERT. To refresh the catalogue, re-export the JSON from
the dev DB and the seed will converge on next install/update.
