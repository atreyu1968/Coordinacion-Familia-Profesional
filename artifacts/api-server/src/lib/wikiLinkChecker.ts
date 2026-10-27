import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, wikiExternalLinksTable as links, wikiPagesTable as pages } from "@workspace/db";
import { logger } from "./logger";
import { linkCheckUpdate, probeWikiLink } from "./wikiLinkProbe";

let running = false;
export async function checkDueWikiLinks(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Small sequential batches, persisted deadlines and SKIP LOCKED bound retries
    // and prevent duplicate checks across server instances.
    for (let i = 0; i < 10; i++) {
      const checked = await db.transaction(async (tx) => {
        const [link] = await tx.select({
          id: links.id, url: links.url, missingCount: links.missingCount, failureCount: links.failureCount,
          checkStatus: links.checkStatus, httpStatus: links.httpStatus,
          redirectUrl: links.redirectUrl, incidentVersion: links.incidentVersion,
        }).from(links).innerJoin(pages, eq(pages.id, links.pageId))
          .where(and(isNull(links.deletedAt), isNull(pages.deletedAt),
            isNull(pages.moduleId), sql`${pages.tags} @> ARRAY['normativa']::text[]`,
            lte(links.nextCheckAt, new Date())))
          .orderBy(asc(links.nextCheckAt), asc(links.id)).limit(1)
          .for("update", { of: links, skipLocked: true });
        if (!link) return false;
        const result = await probeWikiLink(link.url);
        await tx.update(links).set(linkCheckUpdate(result, link)).where(eq(links.id, link.id));
        return true;
      });
      if (!checked) break;
    }
  } catch (err) {
    logger.error({ err }, "Could not check Normativa links");
  } finally {
    running = false;
  }
}

export function startWikiLinkChecker(): void {
  const initial = setTimeout(() => void checkDueWikiLinks(), 30_000);
  initial.unref();
  const interval = setInterval(() => void checkDueWikiLinks(), 5 * 60_000);
  interval.unref();
}
