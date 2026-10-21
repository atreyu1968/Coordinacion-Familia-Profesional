import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  groupsTable,
  teachingAssignmentsTable,
  trainingOfferTable,
} from "@workspace/db";

export async function copyAcademicYearData(options: {
  fromYear: string;
  toYear: string;
  copyGroups: boolean;
  copyTrainingOffer: boolean;
  copyAssignments: boolean;
}) {
  const { fromYear, toYear } = options;
  return db.transaction(async (tx) => {
    // Serialize transitions into the same destination, including concurrent
    // requests from different browser sessions. All copies commit together.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('academic-year-transition'), hashtext(${toYear}))`,
    );
    let groupsCopied = 0;
    let offerCopied = 0;
    let assignmentsCopied = 0;
    const touchedModuleIds = new Set<number>();
    const groupKey = (centerId: number, name: string) =>
      JSON.stringify([centerId, name]);
    const sourceGroups = await tx.select().from(groupsTable).where(
      and(eq(groupsTable.schoolYear, fromYear), isNull(groupsTable.deletedAt)),
    );
    const destinationGroups = await tx.select().from(groupsTable).where(
      and(eq(groupsTable.schoolYear, toYear), isNull(groupsTable.deletedAt)),
    );
    const targetGroups = new Map(
      destinationGroups.map((group) => [groupKey(group.centerId, group.name), group.id]),
    );
    const groupIdMap = new Map<number, number>();
    for (const group of sourceGroups) {
      const key = groupKey(group.centerId, group.name);
      let destinationId = targetGroups.get(key);
      if (destinationId == null && options.copyGroups) {
        const [created] = await tx.insert(groupsTable).values({
          centerId: group.centerId,
          name: group.name,
          cycleName: group.cycleName,
          schoolYear: toYear,
        }).returning({ id: groupsTable.id });
        destinationId = created!.id;
        targetGroups.set(key, destinationId);
        groupsCopied += 1;
      }
      if (destinationId != null) groupIdMap.set(group.id, destinationId);
    }

    if (options.copyTrainingOffer) {
      const source = await tx.select().from(trainingOfferTable).where(
        and(eq(trainingOfferTable.schoolYear, fromYear), isNull(trainingOfferTable.deletedAt)),
      );
      const destination = await tx.select().from(trainingOfferTable).where(
        and(eq(trainingOfferTable.schoolYear, toYear), isNull(trainingOfferTable.deletedAt)),
      );
      const offerKey = (row: typeof trainingOfferTable.$inferSelect) =>
        JSON.stringify([row.centerId, row.cycleName, row.shift ?? ""]);
      const seen = new Set(destination.map(offerKey));
      for (const offer of source) {
        const key = offerKey(offer);
        if (seen.has(key)) continue;
        await tx.insert(trainingOfferTable).values({
          centerId: offer.centerId,
          cycleId: offer.cycleId,
          cycleName: offer.cycleName,
          level: offer.level,
          shift: offer.shift,
          schoolYear: toYear,
        });
        seen.add(key);
        offerCopied += 1;
      }
    }

    if (options.copyAssignments) {
      const source = await tx.select().from(teachingAssignmentsTable).where(
        and(eq(teachingAssignmentsTable.schoolYear, fromYear), isNull(teachingAssignmentsTable.deletedAt)),
      );
      const destination = await tx.select().from(teachingAssignmentsTable).where(
        and(eq(teachingAssignmentsTable.schoolYear, toYear), isNull(teachingAssignmentsTable.deletedAt)),
      );
      const assignmentKey = (row: typeof teachingAssignmentsTable.$inferSelect) =>
        JSON.stringify([row.teacherId, row.moduleId, row.centerId]);
      const seen = new Map(destination.map((row) => [assignmentKey(row), row]));
      for (const assignment of source) {
        const key = assignmentKey(assignment);
        // A destination assignment must never point at a group in another
        // academic year. Without a matching destination group, detach it.
        const groupId = assignment.groupId == null
          ? null
          : groupIdMap.get(assignment.groupId) ?? null;
        const existing = seen.get(key);
        if (existing) {
          // Repair the specific legacy-copy error without overwriting a group
          // that was independently chosen in the destination year.
          if (assignment.groupId != null && existing.groupId === assignment.groupId) {
            await tx.update(teachingAssignmentsTable).set({ groupId }).where(
              eq(teachingAssignmentsTable.id, existing.id),
            );
          }
          continue;
        }
        const [created] = await tx.insert(teachingAssignmentsTable).values({
          teacherId: assignment.teacherId,
          moduleId: assignment.moduleId,
          groupId,
          centerId: assignment.centerId,
          schoolYear: toYear,
        }).returning();
        seen.set(key, created!);
        assignmentsCopied += 1;
        touchedModuleIds.add(assignment.moduleId);
      }
    }
    return { groupsCopied, offerCopied, assignmentsCopied, touchedModuleIds: [...touchedModuleIds] };
  });
}
