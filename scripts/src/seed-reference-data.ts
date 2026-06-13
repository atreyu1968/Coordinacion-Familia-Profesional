import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { and, eq } from "drizzle-orm";
import {
  db,
  pool,
  provincesTable,
  islandsTable,
  municipalitiesTable,
  centersTable,
} from "@workspace/db";

// Preloads the official reference data (Canarias provinces, islands,
// municipalities and the directory of FP centers with their nature, center type
// and professional families) so a fresh install AND any later update end up with
// the full dataset, without any manual import.
//
// The data lives in ./data/*.json (exported from the source open-data datasets).
// Seeding is an idempotent upsert keyed on stable business identifiers, NOT on
// the serial ids in the JSON (those would collide with rows an admin created in
// the app). Foreign keys are resolved by looking up the real id each parent row
// has in the target database:
//   - provinces      -> matched by `code`
//   - islands        -> matched by (provinceId, name)
//   - municipalities -> matched by (islandId, name)
//   - centers        -> matched by `code`
//
// Existing rows are never duplicated. For centers that already exist, only the
// official metadata (nature, centerType, families) is backfilled when it is
// still empty, so admin edits are preserved while updates still converge to the
// official catalogue. Everything runs in a single transaction.

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");

function load<T>(name: string): T[] {
  return JSON.parse(readFileSync(join(dataDir, `${name}.json`), "utf8")) as T[];
}

type ProvinceRow = { id: number; name: string; code: string | null };
type IslandRow = { id: number; provinceId: number; name: string };
type MunicipalityRow = { id: number; islandId: number; name: string };
type CenterRow = {
  id: number;
  name: string;
  code: string | null;
  provinceId: number | null;
  islandId: number | null;
  municipalityId: number | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  nature: string | null;
  centerType: string | null;
  families: string[];
};

async function main(): Promise<void> {
  const provinces = load<ProvinceRow>("provinces");
  const islands = load<IslandRow>("islands");
  const municipalities = load<MunicipalityRow>("municipalities");
  const centers = load<CenterRow>("centers");

  // Names keyed by the (source) id used in the JSON, so a center/island can
  // resolve its parent by name and then to the real id in the target DB.
  const provinceNameBySrcId = new Map(provinces.map((p) => [p.id, p.name]));
  const islandNameBySrcId = new Map(islands.map((i) => [i.id, i.name]));
  const municipalityNameBySrcId = new Map(
    municipalities.map((m) => [m.id, m.name]),
  );

  const stats = { inserted: 0, updated: 0, skipped: 0 };

  await db.transaction(async (tx) => {
    // --- provinces (key: code) --------------------------------------------
    const provinceIdBySrcId = new Map<number, number>();
    for (const p of provinces) {
      const existing = p.code
        ? await tx
            .select({ id: provincesTable.id })
            .from(provincesTable)
            .where(eq(provincesTable.code, p.code))
            .limit(1)
        : await tx
            .select({ id: provincesTable.id })
            .from(provincesTable)
            .where(eq(provincesTable.name, p.name))
            .limit(1);
      let id: number;
      if (existing.length > 0) {
        id = existing[0].id;
        stats.skipped++;
      } else {
        const [row] = await tx
          .insert(provincesTable)
          .values({ name: p.name, code: p.code })
          .returning({ id: provincesTable.id });
        id = row.id;
        stats.inserted++;
      }
      provinceIdBySrcId.set(p.id, id);
    }

    // --- islands (key: provinceId + name) ---------------------------------
    const islandIdBySrcId = new Map<number, number>();
    for (const i of islands) {
      const provinceId = provinceIdBySrcId.get(i.provinceId);
      if (provinceId === undefined) {
        throw new Error(
          `Island "${i.name}" references unknown province id ${i.provinceId}`,
        );
      }
      const existing = await tx
        .select({ id: islandsTable.id })
        .from(islandsTable)
        .where(
          and(eq(islandsTable.provinceId, provinceId), eq(islandsTable.name, i.name)),
        )
        .limit(1);
      let id: number;
      if (existing.length > 0) {
        id = existing[0].id;
        stats.skipped++;
      } else {
        const [row] = await tx
          .insert(islandsTable)
          .values({ provinceId, name: i.name })
          .returning({ id: islandsTable.id });
        id = row.id;
        stats.inserted++;
      }
      islandIdBySrcId.set(i.id, id);
    }

    // --- municipalities (key: islandId + name) ----------------------------
    const municipalityIdBySrcId = new Map<number, number>();
    for (const m of municipalities) {
      const islandId = islandIdBySrcId.get(m.islandId);
      if (islandId === undefined) {
        throw new Error(
          `Municipality "${m.name}" references unknown island id ${m.islandId}`,
        );
      }
      const existing = await tx
        .select({ id: municipalitiesTable.id })
        .from(municipalitiesTable)
        .where(
          and(
            eq(municipalitiesTable.islandId, islandId),
            eq(municipalitiesTable.name, m.name),
          ),
        )
        .limit(1);
      let id: number;
      if (existing.length > 0) {
        id = existing[0].id;
        stats.skipped++;
      } else {
        const [row] = await tx
          .insert(municipalitiesTable)
          .values({ islandId, name: m.name })
          .returning({ id: municipalitiesTable.id });
        id = row.id;
        stats.inserted++;
      }
      municipalityIdBySrcId.set(m.id, id);
    }

    // --- centers (key: code) ----------------------------------------------
    for (const c of centers) {
      const provinceId =
        c.provinceId != null ? (provinceIdBySrcId.get(c.provinceId) ?? null) : null;
      const islandId =
        c.islandId != null ? (islandIdBySrcId.get(c.islandId) ?? null) : null;
      const municipalityId =
        c.municipalityId != null
          ? (municipalityIdBySrcId.get(c.municipalityId) ?? null)
          : null;

      const existing = c.code
        ? await tx
            .select({
              id: centersTable.id,
              nature: centersTable.nature,
              centerType: centersTable.centerType,
              families: centersTable.families,
            })
            .from(centersTable)
            .where(eq(centersTable.code, c.code))
            .limit(1)
        : await tx
            .select({
              id: centersTable.id,
              nature: centersTable.nature,
              centerType: centersTable.centerType,
              families: centersTable.families,
            })
            .from(centersTable)
            .where(eq(centersTable.name, c.name))
            .limit(1);

      if (existing.length > 0) {
        // Backfill official metadata only where it is still missing so any
        // admin-provided values are preserved.
        const ex = existing[0];
        const patch: Partial<{
          nature: string | null;
          centerType: string | null;
          families: string[];
        }> = {};
        if (!ex.nature && c.nature) patch.nature = c.nature;
        if (!ex.centerType && c.centerType) patch.centerType = c.centerType;
        if ((ex.families?.length ?? 0) === 0 && c.families.length > 0) {
          patch.families = c.families;
        }
        if (Object.keys(patch).length > 0) {
          await tx.update(centersTable).set(patch).where(eq(centersTable.id, ex.id));
          stats.updated++;
        } else {
          stats.skipped++;
        }
      } else {
        await tx.insert(centersTable).values({
          name: c.name,
          code: c.code,
          provinceId,
          islandId,
          municipalityId,
          address: c.address,
          latitude: c.latitude,
          longitude: c.longitude,
          phone: c.phone,
          email: c.email,
          website: c.website,
          nature: c.nature,
          centerType: c.centerType,
          families: c.families ?? [],
        });
        stats.inserted++;
      }
    }
  });

  console.log(
    `Reference data ready — inserted: ${stats.inserted}, updated: ${stats.updated}, unchanged: ${stats.skipped}.`,
  );
}

main()
  .catch((err) => {
    console.error("Failed to seed reference data:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
