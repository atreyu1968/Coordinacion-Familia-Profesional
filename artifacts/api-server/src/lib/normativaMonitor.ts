import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, normativaPublicationsTable as publications, normativaSourcesTable as sources, notificationsTable, usersTable, wikiExternalLinksTable } from "@workspace/db";
import { boeText, classify, isCandidate, officialFetch, parseBoc, parseBocArchive, parseBoe, plainText, type Publication } from "./normativaFeeds";
import { getActiveFamily } from "./settings";
import { logger } from "./logger";
import { emitToUser } from "./realtime";
import { toNotification } from "./mappers";
import { sendPushToUsers, withPushPath } from "./push";

const DAY = 86400000;
const dayString = (d: number) => new Date(d).toISOString().slice(0, 10);
let running = false;
let timer: NodeJS.Timeout | undefined;
export const normativaIsRunning = () => running;

export function officialKey(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "www.boe.es" || u.hostname === "boe.es") return url.match(/BOE-A-\d{4}-\d+/i)?.[0]?.toUpperCase() ?? null;
    if (!["www.gobiernodecanarias.org", "sede.gobiernodecanarias.org"].includes(u.hostname)) return null;
    const m = u.pathname.match(/\/boc\/(?:archivo\/)?(\d{4})\/(\d+)\/(\d+)\.html/i)
      ?? u.pathname.match(/boc-a-(\d{4})-(\d+)-(\d+)\.pdf/i);
    return m ? `BOC-A-${m[1]}-${Number(m[2])}-${Number(m[3])}` : null;
  } catch { return null; }
}

export async function checkNormativa(now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    // ADG-specific classifier must not silently classify a different configured family.
    if (await getActiveFamily() !== "Administración y Gestión") return;
    const today = now.toISOString().slice(0, 10);
    const baselineLinks = await db.select({ title: wikiExternalLinksTable.title, url: wikiExternalLinksTable.url }).from(wikiExternalLinksTable);
    const baseline = new Set(baselineLinks.map((r) => officialKey(r.url)).filter(Boolean));
    const knownTitles = baselineLinks.map((r) => r.title);
    for (const source of ["BOE", "BOC"] as const) {
      const notices = await db.transaction(async (tx) => {
        const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${`coordina:normativa-monitor:${source}`})) as locked`);
        if (!lock.rows[0]?.locked) return [];
        const initial = dayString(Date.parse(today) - 6 * DAY);
        await tx.insert(sources).values({ source, startedFrom: initial }).onConflictDoNothing();
        const [state] = await tx.select().from(sources).where(eq(sources.source, source));
        const start = state!.coveredThrough ?? state!.startedFrom;
        const end = dayString(Math.min(Date.parse(today), Date.parse(start) + 6 * DAY));
        const recipients = await tx.select({ id: usersTable.id }).from(usersTable).where(and(
          inArray(usersTable.role, ["superadmin", "coordinator"]), eq(usersTable.status, "active"), isNull(usersTable.deletedAt),
        ));
        const createdNotices: (typeof notificationsTable.$inferSelect)[] = [];
        let covered = state!.coveredThrough;
        let error: string | null = null;
        const archives = new Map<string, Map<string, string[]>>();
        for (let date = Date.parse(start); date <= Date.parse(end); date += DAY) {
          const day = dayString(date);
          let items: Publication[];
          try {
            if (source === "BOE") {
              const response = await officialFetch(`https://www.boe.es/datosabiertos/api/boe/sumario/${day.replaceAll("-", "")}`, "application/json");
              // Official API returns 404 for Sundays/no issue; recheck the last day next run.
              items = response.status === 404 ? [] : parseBoe(response.body, day);
            } else {
              const year = day.slice(0, 4);
              if (!archives.has(year)) {
                const response = await officialFetch(`https://www.gobiernodecanarias.org/boc/archivo/${year}/`);
                archives.set(year, parseBocArchive(response.body));
              }
              items = [];
              for (const url of archives.get(year)!.get(day) ?? []) {
                const response = await officialFetch(url);
                items.push(...parseBoc(response.body, day));
              }
            }
            items = items.filter((item) => isCandidate(item.title, knownTitles));
            if (items.length > 100) throw new Error("Demasiadas publicaciones; revisar la fuente antes de continuar");
          } catch (err) {
            error = err instanceof Error ? err.message : "No se pudo consultar la fuente oficial";
            break; // Preserve cursor: next run retries this date, never skips failed days.
          }
          for (const item of items) {
            const [existing] = await tx.select({ id: publications.id }).from(publications).where(and(eq(publications.source, source), eq(publications.officialId, item.officialId)));
            if (existing) {
              await tx.update(publications).set({ checkedAt: now }).where(eq(publications.id, existing.id));
              continue;
            }
            let fullText: string | null = null;
            if (item.textUrl) {
              try {
                const detail = await officialFetch(item.textUrl, source === "BOE" ? "application/xml" : "text/html");
                if (detail.status === 200) fullText = source === "BOE" ? boeText(detail.body) : plainText(detail.body);
              } catch (err) { logger.warn({ source, officialId: item.officialId, err }, "Normativa text unavailable; manual review required"); }
            }
            const classification = classify(item.title, fullText);
            const isBaseline = baseline.has(item.officialId);
            const [created] = await tx.insert(publications).values({
              source, officialId: item.officialId, title: item.title, url: item.url, publishedAt: item.publishedAt,
              checkedAt: now, ...classification, status: isBaseline ? "catalog" : "pending",
            }).onConflictDoNothing().returning({ id: publications.id });
            if (created && !isBaseline && classification.relevance !== "other" && recipients.length) {
              // Durable notice and deduplication commit together. Transport failures cannot lose the notice.
              createdNotices.push(...await tx.insert(notificationsTable).values(recipients.map(({ id }) => ({
                userId: id, title: "Nueva publicación oficial para revisar",
                body: `${source} · ${item.title}\nRevisa su alcance en Documentación → Seguimiento normativo. No implica vigencia.`,
                type: "normativa", target: { kind: "normativa", id: created.id },
              }))).returning());
            }
          }
          covered = day;
        }
        await tx.update(sources).set({
          attemptedAt: now, coveredThrough: covered, error,
          ...(error ? {} : { succeededAt: now }),
        }).where(eq(sources.source, source));
        return createdNotices;
      });
      for (const notice of notices) emitToUser(notice.userId, "notification", toNotification(notice));
      if (notices.length) {
        void sendPushToUsers([...new Set(notices.map((n) => n.userId))], withPushPath({
          title: "Novedades normativas para revisar", body: "Consulta Documentación → Seguimiento normativo. Requiere revisión humana.",
          data: { type: "normativa", target: notices[0]!.target },
        })).catch((err) => logger.warn({ err }, "Normativa push delivery failed"));
      }
    }
  } finally { running = false; }
}

export function queueNormativaCheck(): void {
  void checkNormativa().catch((err) => logger.error({ err }, "Normativa monitoring failed"));
}
export function startNormativaMonitor(): void {
  if (timer) return;
  setTimeout(queueNormativaCheck, 90000).unref();
  timer = setInterval(queueNormativaCheck, 24 * 60 * 60 * 1000);
  timer.unref();
}
