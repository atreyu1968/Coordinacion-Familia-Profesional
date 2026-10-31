import { db, forumDigestEventsTable } from "@workspace/db";

export const DIGEST_WINDOW_MS = 5 * 60_000;
export type ForumDigestKind = "debate" | "reply" | "synthesis" | "consultation" | "publication";

/** Called inside the source mutation's transaction: no committed change without its queue entry. */
export async function enqueueForumDigest(store: Pick<typeof db, "insert">, event: {
  moduleId: number; threadId: number; actorId: number; eventKey: string; kind: ForumDigestKind;
}, now = new Date()) {
  const bucketAt = new Date((Math.floor(now.getTime() / DIGEST_WINDOW_MS) + 1) * DIGEST_WINDOW_MS);
  await store.insert(forumDigestEventsTable).values({ ...event, bucketAt, nextAttemptAt: bucketAt })
    .onConflictDoNothing({ target: [forumDigestEventsTable.moduleId, forumDigestEventsTable.eventKey] });
}
