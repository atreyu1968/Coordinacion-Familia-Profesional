import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  isNotNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { chatAttachmentDeletionsTable, db } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";

export const CHAT_ATTACHMENT_DELETE_MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60 * 1000;
const WORKER_INTERVAL_MS = 30_000;
const MAX_JOBS_PER_TICK = 10;
const SAFE_DELETE_ERROR = "No se pudo borrar el archivo en Object Storage.";

const storage = new ObjectStorageService();

function retryDelayMs(attempt: number): number {
  return Math.min(60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

export async function enqueueChatAttachmentDeletions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  objectPaths: string[],
): Promise<number[]> {
  if (objectPaths.length === 0) return [];
  const rows = await tx
    .insert(chatAttachmentDeletionsTable)
    .values(
      objectPaths.map((objectPath) => ({
        objectPath,
        status: "pending",
        nextAttemptAt: new Date(),
      })),
    )
    .returning({ id: chatAttachmentDeletionsTable.id });
  return rows.map((row) => row.id);
}

async function claimDeletion(id?: number) {
  const now = new Date();
  const token = randomUUID();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(chatAttachmentDeletionsTable)
      .where(
        and(
          isNotNull(chatAttachmentDeletionsTable.objectPath),
          or(
            and(
              eq(chatAttachmentDeletionsTable.status, "pending"),
              sql`${chatAttachmentDeletionsTable.attempts} < ${CHAT_ATTACHMENT_DELETE_MAX_ATTEMPTS}`,
              lte(chatAttachmentDeletionsTable.nextAttemptAt, now),
            ),
            and(
              eq(chatAttachmentDeletionsTable.status, "processing"),
              lte(chatAttachmentDeletionsTable.leaseUntil, now),
            ),
          ),
          ...(id === undefined ? [] : [eq(chatAttachmentDeletionsTable.id, id)]),
        ),
      )
      .orderBy(asc(chatAttachmentDeletionsTable.id))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate?.objectPath) return null;
    if (candidate.attempts >= CHAT_ATTACHMENT_DELETE_MAX_ATTEMPTS) {
      await tx
        .update(chatAttachmentDeletionsTable)
        .set({
          status: "failed",
          lastError: SAFE_DELETE_ERROR,
          nextAttemptAt: null,
          leaseToken: null,
          leaseUntil: null,
          updatedAt: now,
        })
        .where(eq(chatAttachmentDeletionsTable.id, candidate.id));
      return null;
    }
    const [claimed] = await tx
      .update(chatAttachmentDeletionsTable)
      .set({
        status: "processing",
        attempts: candidate.attempts + 1,
        lastError: null,
        nextAttemptAt: null,
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
        updatedAt: now,
      })
      .where(eq(chatAttachmentDeletionsTable.id, candidate.id))
      .returning();
    return claimed ? { row: claimed, token } : null;
  });
}

export async function processNextChatAttachmentDeletion(
  id?: number,
): Promise<boolean> {
  const claimed = await claimDeletion(id);
  if (!claimed?.row.objectPath) return false;

  try {
    await storage.deleteObjectEntity(claimed.row.objectPath);
    await db
      .update(chatAttachmentDeletionsTable)
      .set({
        status: "done",
        objectPath: null,
        lastError: null,
        nextAttemptAt: null,
        leaseToken: null,
        leaseUntil: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatAttachmentDeletionsTable.id, claimed.row.id),
          eq(chatAttachmentDeletionsTable.leaseToken, claimed.token),
        ),
      );
  } catch {
    const now = new Date();
    const exhausted = claimed.row.attempts >= CHAT_ATTACHMENT_DELETE_MAX_ATTEMPTS;
    await db
      .update(chatAttachmentDeletionsTable)
      .set({
        status: exhausted ? "failed" : "pending",
        lastError: SAFE_DELETE_ERROR,
        nextAttemptAt: exhausted
          ? null
          : new Date(now.getTime() + retryDelayMs(claimed.row.attempts)),
        leaseToken: null,
        leaseUntil: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(chatAttachmentDeletionsTable.id, claimed.row.id),
          eq(chatAttachmentDeletionsTable.leaseToken, claimed.token),
        ),
      );
    logger.warn(
      { deletionId: claimed.row.id, attempts: claimed.row.attempts, exhausted },
      "Chat attachment deletion did not complete",
    );
  }
  return true;
}

export async function retryChatAttachmentDeletion(id: number): Promise<boolean> {
  const [reset] = await db
    .update(chatAttachmentDeletionsTable)
    .set({
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date(),
      leaseToken: null,
      leaseUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatAttachmentDeletionsTable.id, id),
        eq(chatAttachmentDeletionsTable.status, "failed"),
        isNotNull(chatAttachmentDeletionsTable.objectPath),
      ),
    )
    .returning({ id: chatAttachmentDeletionsTable.id });
  if (!reset) return false;
  await processNextChatAttachmentDeletion(id);
  return true;
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startChatAttachmentDeletionWorker(): void {
  if (timer) return;
  let running = false;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      for (let i = 0; i < MAX_JOBS_PER_TICK; i += 1) {
        if (!(await processNextChatAttachmentDeletion())) break;
      }
    })()
      .catch((err) => {
        logger.warn({ err }, "Could not process chat attachment deletion queue");
      })
      .finally(() => {
        running = false;
      });
  }, WORKER_INTERVAL_MS);
  timer.unref();
}
