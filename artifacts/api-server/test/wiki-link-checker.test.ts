import { beforeEach, expect, it, vi } from "vitest";
import { checkDueWikiLinks } from "../src/lib/wikiLinkChecker";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), probe: vi.fn(), select: vi.fn(), update: vi.fn(),
}));
vi.mock("@workspace/db", async (original) => ({
  ...await original<typeof import("@workspace/db")>(),
  db: { transaction: mocks.transaction },
}));
vi.mock("../src/lib/wikiLinkProbe", async (original) => ({
  ...await original<typeof import("../src/lib/wikiLinkProbe")>(),
  probeWikiLink: mocks.probe,
}));

let rows: Array<{ id: number; url: string; missingCount: number; failureCount: number }>;
let lock: ReturnType<typeof vi.fn>;
const payloads: unknown[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  payloads.length = 0;
  rows = [{ id: 42, url: "https://www.boe.es/edited", missingCount: 2, failureCount: 2 }];
  lock = vi.fn(async () => rows.length ? [rows.shift()] : []);
  const query = {
    innerJoin: () => query, where: () => query, orderBy: () => query,
    limit: () => query, for: lock,
  };
  mocks.select.mockReturnValue({ from: () => query });
  mocks.update.mockReturnValue({
    set: (data: unknown) => { payloads.push(data); return { where: vi.fn(async () => undefined) }; },
  });
  mocks.transaction.mockImplementation(async (run) => run({ select: mocks.select, update: mocks.update }));
  mocks.probe.mockResolvedValue({ kind: "absent", httpStatus: 410, redirectUrl: null });
});

it("locks each due link and only updates its diagnostic metadata", async () => {
  await checkDueWikiLinks();
  expect(mocks.probe).toHaveBeenCalledExactlyOnceWith("https://www.boe.es/edited");
  expect(lock).toHaveBeenCalledWith("update", expect.objectContaining({ skipLocked: true }));
  expect(payloads).toEqual([expect.objectContaining({ checkStatus: "missing", missingCount: 3, httpStatus: 410 })]);
  expect(payloads[0]).not.toHaveProperty("url");
  expect(payloads[0]).not.toHaveProperty("title");
  expect(payloads[0]).not.toHaveProperty("content");
});

it("limits each batch to ten sequential checks", async () => {
  rows = Array.from({ length: 30 }, (_, i) => ({ id: i, url: "https://www.boe.es/", missingCount: 0, failureCount: 0 }));
  await checkDueWikiLinks();
  expect(mocks.probe).toHaveBeenCalledTimes(10);
  expect(rows).toHaveLength(20);
});

it("prevents overlapping runs and recovers after a transaction failure", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  mocks.transaction.mockImplementationOnce(async () => { await pending; throw new Error("DB unavailable"); });
  const first = checkDueWikiLinks();
  await checkDueWikiLinks();
  expect(mocks.transaction).toHaveBeenCalledTimes(1);
  release();
  await first;
  await checkDueWikiLinks();
  expect(mocks.probe).toHaveBeenCalledTimes(1);
});
