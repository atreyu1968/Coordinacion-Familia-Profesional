import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, cyclesTable, modulesTable } from "@workspace/db";
import { loadFpaCatalog } from "./fp-adapted-catalog";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Stable catalog IDs preserve teaching assignments, module groups and forums. */
export async function seedFpaCatalog(tx: Transaction) {
  const catalog = loadFpaCatalog();
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('coordina:fpa-adg-catalog'))`);
  const stats = { inserted: 0, updated: 0, skipped: 0 };
  for (const itinerary of catalog.itineraries) {
    const [existingCycle] = await tx.select().from(cyclesTable).where(and(
      eq(cyclesTable.level, catalog.level),
      or(eq(cyclesTable.name, itinerary.name), eq(cyclesTable.code, itinerary.certificateCode)),
    )).limit(1);
    // Explicitly removed records stay removed; never recreate their modules.
    if (existingCycle?.deletedAt) { stats.skipped++; continue; }
    let cycle = existingCycle;
    if (!cycle) {
      [cycle] = await tx.insert(cyclesTable).values({
        name: itinerary.name, code: itinerary.certificateCode, level: catalog.level,
      }).returning();
      stats.inserted++;
    } else if (!cycle.code) {
      await tx.update(cyclesTable).set({ code: itinerary.certificateCode }).where(eq(cyclesTable.id, cycle.id));
      stats.updated++;
    } else {
      stats.skipped++;
    }
    if (!cycle) throw new Error("No se pudo crear el itinerario FPA.");
    for (const module of [...itinerary.modules, ...catalog.commonModules]) {
      const [existing] = await tx.select().from(modulesTable).where(and(
        eq(modulesTable.cycleId, cycle.id), isNull(modulesTable.centerId),
        module.code
          ? or(eq(modulesTable.code, module.code), eq(modulesTable.name, module.name))
          : eq(modulesTable.name, module.name),
      )).limit(1);
      if (existing) {
        if (!existing.deletedAt && !existing.code && module.code) {
          await tx.update(modulesTable).set({ code: module.code }).where(eq(modulesTable.id, existing.id));
          stats.updated++;
        } else { stats.skipped++; }
      } else {
        await tx.insert(modulesTable).values({
          code: module.code, name: module.name,
          cycleId: cycle.id, cycleName: cycle.name, centerId: null,
        });
        stats.inserted++;
      }
    }
  }
  return stats;
}
