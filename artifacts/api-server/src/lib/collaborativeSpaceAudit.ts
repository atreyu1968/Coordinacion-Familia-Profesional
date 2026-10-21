import {
  collaborativeSpaceAuditTable as audit, usersTable as users, centersTable as centers,
  type db, type SpaceAuditDetails,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import type { Request } from "express";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Event = typeof audit.$inferInsert;

export async function selectionSnapshot(
  tx: Tx, selection: { userIds?: number[]; centerIds?: number[] }, affectedIds: number[],
): Promise<SpaceAuditDetails> {
  const userIds = [...new Set(selection.userIds ?? [])];
  const centerIds = [...new Set(selection.centerIds ?? [])];
  return {
    selectedUsers: userIds.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [],
    selectedCenters: centerIds.length ? await tx.select({ id: centers.id, name: centers.name }).from(centers).where(inArray(centers.id, centerIds)) : [],
    affectedUsers: affectedIds.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, affectedIds)) : [],
    changedFields: [],
    revocation: "not_applicable",
  };
}

export async function recordSpaceAudit(
  tx: Tx, actor: NonNullable<Request["user"]>, space: { id: number; name: string },
  action: Event["action"], summary: string, details: SpaceAuditDetails,
) {
  // Explicit allowlist. Do not spread actor, body, settings or remote errors.
  await tx.insert(audit).values({
    spaceId: space.id, spaceName: space.name, actorId: actor.id,
    actorName: actor.name, actorRole: actor.role, action, summary, details,
  });
}
