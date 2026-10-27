import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { LinkProbe } from "../src/lib/wikiLinkProbe";

// Only the outbound HTTP probe is replaced. Queries, transactions, locks and
// linkCheckUpdate all use the production implementation and real PostgreSQL.
const mocks = vi.hoisted(() => ({ probe: vi.fn(), error: vi.fn() }));
vi.mock("../src/lib/wikiLinkProbe", async (original) => ({
  ...await original<typeof import("../src/lib/wikiLinkProbe")>(),
  probeWikiLink: mocks.probe,
}));
vi.mock("../src/lib/logger", () => ({ logger: { error: mocks.error } }));

type Database = typeof import("@workspace/db");
type Checker = typeof import("../src/lib/wikiLinkChecker");
const pools: Database["pool"][] = [];
let database: Database;
let first: Checker;
let second: Checker;
let expectedLoggedErrors = 0;

async function newInstance() {
  // Each module graph has its own `running` flag AND its own connection pool.
  // Reusing one import would merely test the in-process guard, not SKIP LOCKED.
  vi.resetModules();
  const db = await import("@workspace/db");
  pools.push(db.pool);
  return { db, checker: await import("../src/lib/wikiLinkChecker") };
}

beforeAll(async () => {
  const root = process.env.COORDINA_WIKI_CHECKER_TEST_ROOT;
  if (!root || !/\/coordina-db-test\.[a-zA-Z0-9]+$/.test(root) || realpathSync(root) !== root) {
    throw new Error("Use bash deploy/test-db.sh --wiki-link-checker-only.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (url.pathname !== "/coordina_wiki_link_checker" || url.searchParams.get("host") !== join(root, "socket")) {
    throw new Error("Refusing non-isolated wiki checker database.");
  }
  const instance = await newInstance();
  database = instance.db;
  first = instance.checker;
  // Check the actual server identity before the first fixture write.
  const identity = await database.pool.query(
    "SELECT current_database() AS name, current_setting('data_directory') AS directory, current_setting('listen_addresses') AS listeners",
  );
  expect(identity.rows[0]).toEqual({
    name: "coordina_wiki_link_checker", directory: join(root, "data"), listeners: "",
  });
  second = (await newInstance()).checker;
  expect(first.checkDueWikiLinks).not.toBe(second.checkDueWikiLinks);
});

beforeEach(async () => {
  vi.clearAllMocks();
  expectedLoggedErrors = 0;
  // The identity assertion above is required before this destructive cleanup.
  await database.pool.query("DELETE FROM wiki_pages");
  mocks.probe.mockResolvedValue({ kind: "healthy", httpStatus: 200, redirectUrl: null });
});

afterEach(() => {
  // checkDueWikiLinks catches errors; do not let SQL failures look like success.
  expect(mocks.error).toHaveBeenCalledTimes(expectedLoggedErrors);
});

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function seedLink(suffix: string, due = new Date("2020-01-01T00:00:00Z")) {
  const [page] = await database.db.insert(database.wikiPagesTable).values({
    title: `Normativa ${suffix}`, content: "Contenido revisado por una persona",
    tags: ["normativa"], createdBy: 1, updatedBy: 1,
  }).returning();
  const [link] = await database.db.insert(database.wikiExternalLinksTable).values({
    pageId: page!.id, title: `Fuente ${suffix}`, url: `https://www.boe.es/${suffix}`,
    createdBy: 1, nextCheckAt: due,
  }).returning();
  return link!;
}

async function readLink(id: number) {
  const result = await database.pool.query("SELECT * FROM wiki_external_links WHERE id = $1", [id]);
  return result.rows[0];
}

it.each([
  {
    name: "soft-deleted links",
    statement: "UPDATE wiki_external_links SET deleted_at = now() WHERE id = $1",
    target: "link",
  },
  {
    name: "soft-deleted pages",
    statement: "UPDATE wiki_pages SET deleted_at = now() WHERE id = $1",
    target: "page",
  },
  {
    name: "module pages even when tagged normativa",
    statement: "UPDATE wiki_pages SET module_id = 1 WHERE id = $1",
    target: "page",
  },
  {
    name: "pages with no tags",
    statement: "UPDATE wiki_pages SET tags = ARRAY[]::text[] WHERE id = $1",
    target: "page",
  },
  {
    name: "pages with other tags but not normativa",
    statement: "UPDATE wiki_pages SET tags = ARRAY['otra', 'normativa-extra']::text[] WHERE id = $1",
    target: "page",
  },
  {
    name: "links scheduled in the future",
    statement: "UPDATE wiki_external_links SET next_check_at = now() + interval '1 year' WHERE id = $1",
    target: "link",
  },
])("does not probe or change $name", async ({ statement, target }) => {
  const excluded = await seedLink("excluded");
  await database.pool.query(statement, [target === "link" ? excluded.id : excluded.pageId]);
  const before = await readLink(excluded.id);
  // The older excluded row must not prevent a valid due row from being checked.
  const valid = await seedLink("valid-control", new Date("2020-01-02T00:00:00Z"));
  const pagesBefore = await database.pool.query("SELECT * FROM wiki_pages ORDER BY id");

  await first.checkDueWikiLinks();

  expect(mocks.probe.mock.calls).toEqual([[valid.url]]);
  expect(await readLink(excluded.id)).toEqual(before);
  expect(await readLink(valid.id)).toMatchObject({
    check_status: "healthy", http_status: 200, checked_at: expect.any(Date),
  });
  expect((await database.pool.query("SELECT * FROM wiki_pages ORDER BY id")).rows).toEqual(pagesBefore.rows);
});

it("checks due links by deadline then id, at most ten per run, and leaves the rest pending", async () => {
  // Deliberately insert out of deadline order, with ties on both sides of the
  // batch boundary: sorting only by id or only by deadline must not suffice.
  const offsets = [4, 2, 2, 0, 3, 1, 0, 4, 1, 3, 2, 0, 1];
  const links = [];
  for (const [index, offset] of offsets.entries()) {
    links.push(await seedLink(`batch-${index}`, new Date(Date.UTC(2020, 0, 1 + offset))));
  }
  // Normativa may be one of several tags, not necessarily the first.
  await database.pool.query("UPDATE wiki_pages SET tags = ARRAY['otra', 'normativa']::text[]");
  const ordered = [...links].sort((a, b) =>
    a.nextCheckAt.getTime() - b.nextCheckAt.getTime() || a.id - b.id,
  );
  const before = await Promise.all(ordered.map((link) => readLink(link.id)));
  const pagesBefore = await database.pool.query("SELECT * FROM wiki_pages ORDER BY id");
  const started = Date.now();

  await first.checkDueWikiLinks();

  const finished = Date.now();
  expect(mocks.probe.mock.calls).toEqual(ordered.slice(0, 10).map((link) => [link.url]));
  const firstBatch = await Promise.all(ordered.slice(0, 10).map((link) => readLink(link.id)));
  for (const row of firstBatch) {
    expect(row).toMatchObject({
      check_status: "healthy", http_status: 200, missing_count: 0, failure_count: 0,
    });
    expect(row.checked_at.getTime()).toBeGreaterThanOrEqual(started);
    expect(row.checked_at.getTime()).toBeLessThanOrEqual(finished);
    expect(row.next_check_at.getTime() - row.checked_at.getTime()).toBe(168 * 3_600_000);
  }
  for (let index = 10; index < ordered.length; index++) {
    expect(await readLink(ordered[index]!.id)).toEqual(before[index]);
  }

  await first.checkDueWikiLinks();

  expect(mocks.probe.mock.calls).toEqual(ordered.map((link) => [link.url]));
  for (const link of ordered.slice(10)) {
    expect(await readLink(link.id)).toMatchObject({
      check_status: "healthy", http_status: 200, checked_at: expect.any(Date),
    });
  }
  expect(await Promise.all(ordered.slice(0, 10).map((link) => readLink(link.id)))).toEqual(firstBatch);
  const completed = await Promise.all(ordered.map((link) => readLink(link.id)));

  await first.checkDueWikiLinks();

  expect(mocks.probe).toHaveBeenCalledTimes(13);
  expect(await Promise.all(ordered.map((link) => readLink(link.id)))).toEqual(completed);
  expect((await database.pool.query("SELECT * FROM wiki_pages ORDER BY id")).rows).toEqual(pagesBefore.rows);
});

it("skips a locked link across independent instances and persists deadlines across a restart", async () => {
  const a = await seedLink("first");
  const b = await seedLink("second", new Date("2020-01-02T00:00:00Z"));
  // The second result exercises the persisted retry count and 24-hour backoff.
  await database.pool.query(
    "UPDATE wiki_external_links SET missing_count = 2, failure_count = 1 WHERE id = $1", [b.id],
  );
  const entered = deferred();
  const release = deferred();
  mocks.probe.mockImplementation(async (url: string): Promise<LinkProbe> => {
    if (url === a.url) {
      entered.resolve();
      await release.promise;
      return { kind: "healthy", httpStatus: 200, redirectUrl: null };
    }
    return { kind: "absent", httpStatus: 410, redirectUrl: null };
  });
  const started = Date.now();
  const runningFirst = first.checkDueWikiLinks();
  let runningSecond: Promise<void> | undefined;
  try {
    await entered.promise;
    let secondFinished = false;
    runningSecond = second.checkDueWikiLinks().then(() => { secondFinished = true; });
    // Must finish WHILE the first transaction still holds its row lock. Without
    // SKIP LOCKED this blocks; a shared running flag would skip b altogether.
    await expect.poll(() => secondFinished, { timeout: 2000 }).toBe(true);
    expect(mocks.probe.mock.calls.map(([url]) => url)).toEqual([a.url, b.url]);
    const locked = await readLink(a.id);
    expect(locked.checked_at).toBeNull(); // first transaction has not committed
    expect((await readLink(b.id)).checked_at).toBeInstanceOf(Date);
  } finally {
    release.resolve();
    await Promise.all([runningFirst, runningSecond]);
  }
  const finished = Date.now();
  const savedA = await readLink(a.id);
  const savedB = await readLink(b.id);
  for (const [row, hours] of [[savedA, 168], [savedB, 24]] as const) {
    expect(row.checked_at.getTime()).toBeGreaterThanOrEqual(started);
    expect(row.checked_at.getTime()).toBeLessThanOrEqual(finished);
    expect(row.next_check_at.getTime() - row.checked_at.getTime()).toBe(hours * 3_600_000);
  }
  expect(savedA).toMatchObject({ check_status: "healthy", http_status: 200, missing_count: 0, failure_count: 0 });
  expect(savedB).toMatchObject({ check_status: "missing", http_status: 410, missing_count: 3, failure_count: 2 });
  expect(mocks.probe).toHaveBeenCalledTimes(2);

  const restarted = (await newInstance()).checker;
  await restarted.checkDueWikiLinks();
  await second.checkDueWikiLinks();
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  expect(await readLink(a.id)).toEqual(savedA);
  expect(await readLink(b.id)).toEqual(savedB);
});

it("rolls back a failed metadata update and lets another instance retry exactly once", async () => {
  const link = await seedLink("transaction-failure");
  await database.pool.query(
    "UPDATE wiki_external_links SET check_status = 'healthy', http_status = 200, checked_at = '2025-01-01T00:00:00Z', missing_count = 0, failure_count = 0 WHERE id = $1",
    [link.id],
  );
  const beforeFailure = await readLink(link.id);
  mocks.probe.mockResolvedValue({ kind: "absent", httpStatus: 410, redirectUrl: null });
  expectedLoggedErrors = 1;

  await database.pool.query(`
    CREATE FUNCTION fail_wiki_checker_metadata_update() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'intentional wiki checker transaction failure';
    END;
    $$;
    CREATE TRIGGER fail_wiki_checker_metadata_update
      BEFORE UPDATE ON wiki_external_links
      FOR EACH ROW EXECUTE FUNCTION fail_wiki_checker_metadata_update();
  `);
  try {
    await first.checkDueWikiLinks();
    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith(link.url);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    // The diagnostic result and row lock are part of the same transaction:
    // a failed UPDATE must leave every persisted field exactly as it was.
    expect(await readLink(link.id)).toEqual(beforeFailure);
  } finally {
    await database.pool.query(`
      DROP TRIGGER IF EXISTS fail_wiki_checker_metadata_update ON wiki_external_links;
      DROP FUNCTION IF EXISTS fail_wiki_checker_metadata_update();
    `);
  }

  // This is a separate module graph and pool. It can claim the row only if the
  // failed transaction rolled back and released its FOR UPDATE lock.
  await second.checkDueWikiLinks();
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  const recovered = await readLink(link.id);
  expect(recovered).toMatchObject({
    check_status: "temporary",
    http_status: 410,
    missing_count: 1,
    failure_count: 1,
  });
  expect(recovered.checked_at).toBeInstanceOf(Date);
  expect(recovered.next_check_at.getTime() - recovered.checked_at.getTime()).toBe(6 * 3_600_000);

  // A second pass by either instance must not count the same failure again.
  await first.checkDueWikiLinks();
  await second.checkDueWikiLinks();
  expect(mocks.probe).toHaveBeenCalledTimes(2);
  expect(await readLink(link.id)).toEqual(recovered);
});

it.each(["edit", "soft delete", "hard delete"] as const)(
  "does not undo a concurrent %s of the locked link",
  async (operation) => {
    const link = await seedLink(operation.replaceAll(" ", "-"));
    const entered = deferred();
    const release = deferred();
    mocks.probe.mockImplementation(async (): Promise<LinkProbe> => {
      entered.resolve();
      await release.promise;
      return { kind: "absent", httpStatus: 404, redirectUrl: null };
    });
    const editor = await database.pool.connect();
    const { rows: [{ pid }] } = await editor.query("SELECT pg_backend_pid() AS pid");
    const running = first.checkDueWikiLinks();
    let mutation: Promise<unknown> | undefined;
    try {
      await entered.promise;
      const statement = operation === "edit"
        ? "UPDATE wiki_external_links SET title = 'Título editado', url = 'https://www.boe.es/edited', check_status = 'unchecked', checked_at = NULL, next_check_at = '2099-01-01T00:00:00Z', missing_count = 0, failure_count = 0, http_status = NULL WHERE id = $1"
        : operation === "soft delete"
          ? "UPDATE wiki_external_links SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = $1"
          : "DELETE FROM wiki_external_links WHERE id = $1";
      mutation = editor.query(statement, [link.id]);
      // Prove actual overlap and lock contention, rather than relying on sleeps.
      await expect.poll(async () => {
        const { rows } = await database.pool.query(
          "SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [pid],
        );
        return rows[0].blocked;
      }, { timeout: 2000 }).toBe(true);
      await second.checkDueWikiLinks();
      expect(mocks.probe).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      try {
        await Promise.all([running, mutation]);
      } finally {
        editor.release();
      }
    }
    const saved = await readLink(link.id);
    if (operation === "edit") {
      expect(saved).toMatchObject({
        title: "Título editado", url: "https://www.boe.es/edited",
        check_status: "unchecked", checked_at: null, http_status: null,
        missing_count: 0, failure_count: 0, next_check_at: new Date("2099-01-01T00:00:00Z"),
      });
    } else if (operation === "soft delete") {
      expect(saved.deleted_at).toEqual(new Date("2026-01-01T00:00:00Z"));
    } else {
      expect(saved).toBeUndefined();
    }
    await first.checkDueWikiLinks();
    await second.checkDueWikiLinks();
    expect(mocks.probe).toHaveBeenCalledTimes(1);
    expect(await readLink(link.id)).toEqual(saved);
    const { rows: [page] } = await database.pool.query("SELECT title, content FROM wiki_pages WHERE id = $1", [link.pageId]);
    expect(page).toEqual({ title: `Normativa ${operation.replaceAll(" ", "-")}`, content: "Contenido revisado por una persona" });
  },
);
