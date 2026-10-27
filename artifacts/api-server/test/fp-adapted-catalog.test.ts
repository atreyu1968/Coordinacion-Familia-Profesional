import { readFileSync } from "node:fs";
import { and, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { db, cyclesTable, modulesTable } from "@workspace/db";
import { cycleFamilyFilter, moduleFamilyFilter } from "../src/lib/familyCatalog";
import { fpCycleFamilies } from "../src/lib/generated/fpCycleFamilies";

const catalog = JSON.parse(readFileSync(new URL("../../../scripts/src/data/fpa-adg.json", import.meta.url), "utf8")) as {
  family: string; level: string; itineraries: { name: string; certificateCode: string }[];
};

it("clasifica los dos itinerarios FPA en ADG sin depender de ofertas de centros", () => {
  expect(catalog.itineraries).toHaveLength(2);
  for (const itinerary of catalog.itineraries) {
    expect(fpCycleFamilies[itinerary.name]).toEqual([catalog.family]);
  }
});

it("ofrece FPA y sus módulos solo en la familia activa ADG, aunque no haya oferta local", async () => {
  const rollback = new Error("Rollback isolated FPA fixtures");
  try {
    await db.transaction(async (tx) => {
      const cycles = await tx.insert(cyclesTable).values(catalog.itineraries.map((item) => ({
        name: item.name, code: item.certificateCode, level: catalog.level,
      }))).returning();
      const modules = await tx.insert(modulesTable).values(cycles.map((cycle) => ({
        name: "Reproducción y archivo", code: "MF0971_1",
        cycleId: cycle.id, cycleName: cycle.name, centerId: null,
      }))).returning();
      const ids = cycles.map((cycle) => cycle.id);
      const moduleIds = modules.map((module) => module.id);
      const visibleCycles = await tx.select().from(cyclesTable).where(and(
        inArray(cyclesTable.id, ids), cycleFamilyFilter(catalog.family),
      ));
      const visibleModules = await tx.select().from(modulesTable).where(and(
        inArray(modulesTable.id, moduleIds), moduleFamilyFilter(catalog.family),
      ));
      expect(visibleCycles).toHaveLength(2);
      expect(visibleModules).toHaveLength(2);
      expect(await tx.select().from(cyclesTable).where(and(
        inArray(cyclesTable.id, ids), cycleFamilyFilter("Informática y Comunicaciones"),
      ))).toHaveLength(0);
      expect(await tx.select().from(modulesTable).where(and(
        inArray(modulesTable.id, moduleIds), moduleFamilyFilter("Informática y Comunicaciones"),
      ))).toHaveLength(0);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
