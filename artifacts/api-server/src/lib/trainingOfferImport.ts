import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, centersTable, cyclesTable, integrationSettingsTable, trainingOfferTable, usersTable } from "@workspace/db";
import { cycleFamilyFilter } from "./familyCatalog";
import { professionalFamilyOf } from "./settings";
import { cycleOfferName } from "./trainingOfferOfficial";
import { OfferSyncError, readOfferContext, readOfferResult } from "./trainingOfferAi";

export async function applyTrainingOffer(ownerId: number, contextToken: string, resultTokens: string[]) {
  const context = readOfferContext(contextToken, ownerId);
  const unique = new Map(resultTokens.flatMap(token => readOfferResult(token, context))
    .map(row => [`${row.centerId}:${cycleOfferName(row.cycleName)}`, row]));
  if (!unique.size) throw new OfferSyncError("No hay coincidencias confirmadas que añadir.");
  return db.transaction(async tx => {
    // No network calls inside this transaction. Lock against annual transitions,
    // concurrent imports and manual inserts without a database schema migration.
    const [settings] = await tx.select().from(integrationSettingsTable).limit(1).for("update");
    if (!settings || settings.activeAcademicYear !== context.schoolYear || professionalFamilyOf(settings) !== context.family) {
      throw new OfferSyncError("El curso o la familia activa han cambiado. Inicia otra consulta.", 409);
    }
    const [actor] = await tx.select({ role: usersTable.role, status: usersTable.status, deletedAt: usersTable.deletedAt })
      .from(usersTable).where(eq(usersTable.id, ownerId)).for("update");
    if (!actor || actor.role !== "superadmin" || actor.status !== "active" || actor.deletedAt) {
      throw new OfferSyncError("Ya no tienes permiso para actualizar la oferta.", 403);
    }
    await tx.execute(sql`LOCK TABLE training_offer IN SHARE ROW EXCLUSIVE MODE`);
    const centerIds = [...new Set([...unique.values()].map(row => row.centerId))];
    const centers = await tx.select().from(centersTable).where(and(inArray(centersTable.id, centerIds),
      isNull(centersTable.deletedAt), sql`${centersTable.families} @> ${JSON.stringify([context.family])}::jsonb`)).for("update");
    const cycles = await tx.select().from(cyclesTable).where(and(isNull(cyclesTable.deletedAt), cycleFamilyFilter(context.family)));
    const existing = await tx.select().from(trainingOfferTable).where(and(
      inArray(trainingOfferTable.centerId, centerIds), eq(trainingOfferTable.schoolYear, context.schoolYear),
      isNull(trainingOfferTable.deletedAt)));
    let added = 0; let unchanged = 0;
    for (const row of unique.values()) {
      const center = centers.find(c => c.id === row.centerId && c.code === row.centerCode);
      const cycle = cycles.find(c => c.id === row.cycleId && c.name === row.cycleName && c.level === row.level);
      if (!center || !cycle) throw new OfferSyncError("Ha cambiado un centro o ciclo de la propuesta. Vuelve a consultar la oferta.", 409);
      if (existing.some(o => o.centerId === center.id && cycleOfferName(o.cycleName) === cycleOfferName(cycle.name))) {
        unchanged++; continue;
      }
      await tx.insert(trainingOfferTable).values({ centerId: center.id, cycleId: cycle.id,
        cycleName: cycle.name, level: cycle.level, schoolYear: context.schoolYear });
      added++;
    }
    const matched = new Set([...unique.values()].map(row => row.centerId));
    return { schoolYear: context.schoolYear, added, unchanged, matchedCenters: matched.size,
      pendingCenters: context.centers.filter(c => !matched.has(c.id)).map(c => ({
        id: c.id, name: c.name, reason: c.code && /^\d{8}$/.test(c.code)
          ? "Sin coincidencias documentales confirmadas; se conserva la oferta existente."
          : "Falta un código oficial de centro válido.",
      })) };
  });
}
