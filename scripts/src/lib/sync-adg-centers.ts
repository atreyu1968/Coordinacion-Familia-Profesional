import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { centersTable, provincesTable, type db } from "@workspace/db";

type Database = Pick<typeof db, "select" | "insert" | "update" | "execute">;
type Snapshot = { family: string; updatedAt: string; centers: [string, string, string][] };
const snapshot = JSON.parse(readFileSync(new URL("../data/centers-adg-2026.json", import.meta.url), "utf8")) as Snapshot;
const reference = JSON.parse(readFileSync(new URL("../data/centers.json", import.meta.url), "utf8")) as { code: string | null }[];
const normalize = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toUpperCase();

// Caller supplies a transaction. This snapshot is authoritative ONLY for the
// listed names, contacts, province and membership of this specific family.
// It never deletes, revives, merges two records or removes another family.
export async function syncAdgCenters(tx: Database, apply: boolean) {
  if (snapshot.family !== "Administración y Gestión" || snapshot.centers.length !== 65) {
    throw new Error("Invalid ADG snapshot");
  }
  const codes = new Set<string>();
  for (const [code, name, phone] of snapshot.centers) {
    if (!/^(35|38)\d{6}$/.test(code) || !name.trim() ||
        !/^9(?:22|28) \d{3} \d{3}(?: \/ 9(?:22|28) \d{3} \d{3})*$/.test(phone) || codes.has(code)) {
      throw new Error(`Invalid or duplicate center: ${code}`);
    }
    codes.add(code);
  }
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('coordina:adg-center-directory'))`);
  const rows = await tx.select().from(centersTable);
  const provinces = await tx.select().from(provincesTable);
  const knownCodes = new Set(reference.map((c) => c.code).filter(Boolean));
  const stats = { listed: 65, inserted: 0, updated: 0, unchanged: 0, correctedCodes: 0, inactive: 0, absentCodes: [] as string[] };
  const changes: { existingId: number | null; values: typeof centersTable.$inferInsert }[] = [];

  // Validate ALL matches before writing anything. Ambiguity is an error, not
  // a reason to pick an arbitrary record or silently duplicate a center.
  for (const [code, name, phone] of snapshot.centers) {
    const provinceCode = code.startsWith("35") ? "GC" : "TF";
    const matchingProvinces = provinces.filter((p) => p.code === provinceCode);
    if (matchingProvinces.length !== 1) throw new Error(`Province ${provinceCode} is missing or ambiguous`);
    const byCode = rows.filter((c) => c.code === code);
    if (byCode.length > 1) throw new Error(`Multiple centers use official code ${code}`);
    let existing = byCode[0];
    if (!existing) {
      const byName = rows.filter((c) => normalize(c.name) === normalize(name));
      if (byName.length > 1) throw new Error(`Ambiguous center name: ${name}`);
      if (byName[0]) {
        const candidate = byName[0];
        if (candidate.code && (codes.has(candidate.code) || knownCodes.has(candidate.code))) {
          throw new Error(`Name/code conflict for ${name}; manual review required`);
        }
        existing = candidate;
        stats.correctedCodes++;
      }
    }
    const families = existing?.families.includes(snapshot.family)
      ? existing.families : [...(existing?.families ?? []), snapshot.family];
    const values = {
      code, name, phone, email: `${code}@gobiernodecanarias.org`,
      provinceId: matchingProvinces[0].id, families,
      centerType: name.split(" ")[0],
    };
    if (existing?.deletedAt) stats.inactive++;
    if (!existing) {
      stats.inserted++;
      changes.push({ existingId: null, values });
    } else if (Object.entries(values).some(([key, value]) =>
      JSON.stringify(existing[key as keyof typeof existing]) !== JSON.stringify(value))) {
      stats.updated++;
      changes.push({ existingId: existing.id, values });
    } else {
      stats.unchanged++;
    }
  }
  stats.absentCodes = rows.filter((c) =>
    c.deletedAt == null && c.code != null && c.families.includes(snapshot.family) && !codes.has(c.code),
  ).map((c) => c.code!);
  if (apply) {
    for (const change of changes) {
      if (change.existingId == null) await tx.insert(centersTable).values(change.values);
      else await tx.update(centersTable).set(change.values).where(eq(centersTable.id, change.existingId));
    }
  }
  return stats;
}
