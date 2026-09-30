export type BeforeIdParseResult =
  | { ok: true; beforeId?: number }
  | { ok: false };

export function parseBeforeId(value: unknown): BeforeIdParseResult {
  if (value === undefined) return { ok: true };
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    return { ok: false };
  }

  const beforeId = Number(value);
  return Number.isSafeInteger(beforeId)
    ? { ok: true, beforeId }
    : { ok: false };
}