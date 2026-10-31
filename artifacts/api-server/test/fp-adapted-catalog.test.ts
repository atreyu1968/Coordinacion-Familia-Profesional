import { readFileSync } from "node:fs";
import request from "supertest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import {
  db,
  cyclesTable,
  integrationSettingsTable,
  modulesTable,
  trainingOfferTable,
} from "@workspace/db";
import app from "../src/app";
import { getActiveFamily } from "../src/lib/settings";
import { cycleFamilyFilter, moduleFamilyFilter } from "../src/lib/familyCatalog";
import { fpCycleFamilies } from "../src/lib/generated/fpCycleFamilies";
import { authHeader, cleanup, createCenter, createProvince, createUser } from "./helpers";
import { seedFpaCatalog } from "../../../scripts/src/lib/seed-fpa";
import type { FpaCatalog } from "../../../scripts/src/lib/fp-adapted-catalog";

const catalog = JSON.parse(readFileSync(new URL("../../../scripts/src/data/fpa-adg.json", import.meta.url), "utf8")) as {
  family: string;
  level: string;
  commonModules: { name: string; code: string | null; hours: number; weeklyHours: number; kind: "professional" | "general" | "tutoring" }[];
  itineraries: {
    name: string;
    certificateCode: string;
    qualificationCode: string;
    source: string;
    modules: { name: string; code: string | null; hours: number; weeklyHours: number; kind: "professional" | "general" | "tutoring" }[];
  }[];
};
const cycleIds: number[] = [];
const moduleIds: number[] = [];

afterAll(async () => {
  if (moduleIds.length) await db.delete(modulesTable).where(inArray(modulesTable.id, moduleIds));
  if (cycleIds.length) await db.delete(cyclesTable).where(inArray(cyclesTable.id, cycleIds));
  await cleanup();
});

it("clasifica los dos itinerarios FPA en ADG sin depender de ofertas de centros", () => {
  expect(catalog.itineraries).toHaveLength(2);
  for (const itinerary of catalog.itineraries) {
    expect(fpCycleFamilies[itinerary.name]).toEqual([catalog.family]);
  }
});

it("ofrece en el perfil los módulos globales FPA sin oferta y excluye otras familias", async () => {
  const [settings] = await db.select().from(integrationSettingsTable).limit(1);
  const createdSettings = !settings;
  const activeSettings = settings
    ?? (await db.insert(integrationSettingsTable).values({}).returning())[0]!;
  const previousFamily = activeSettings.professionalFamily;
  try {
    await db.update(integrationSettingsTable)
      .set({ professionalFamily: catalog.family })
      .where(eq(integrationSettingsTable.id, activeSettings.id));
    expect(await getActiveFamily()).toBe(catalog.family);

    const foreignCycleName = Object.entries(fpCycleFamilies)
      .find(([, families]) => !families.includes(catalog.family))?.[0];
    expect(foreignCycleName).toBeTruthy();
    const cycles = await db.insert(cyclesTable).values([
      ...catalog.itineraries.map((itinerary) => ({
        name: itinerary.name,
        code: itinerary.certificateCode,
        level: catalog.level,
      })),
      { name: foreignCycleName!, level: catalog.level },
    ]).returning();
    cycleIds.push(...cycles.map(({ id }) => id));
    const fpaModules = await db.insert(modulesTable).values([
      ...cycles.slice(0, catalog.itineraries.length).map((cycle, index) => ({
        name: `FPA API ${Date.now()} ${index}`,
        code: null,
        cycleId: cycle.id,
        cycleName: cycle.name,
        centerId: null,
      })),
      {
        name: `Otra familia API ${Date.now()}`,
        cycleId: cycles[catalog.itineraries.length]!.id,
        cycleName: cycles[catalog.itineraries.length]!.name,
        centerId: null,
      },
    ]).returning();
    moduleIds.push(...fpaModules.map(({ id }) => id));
    const familyFilteredModules = await db
      .select({ id: modulesTable.id })
      .from(modulesTable)
      .where(and(
        inArray(modulesTable.id, fpaModules.map(({ id }) => id)),
        moduleFamilyFilter(catalog.family),
      ));
    const familyFilteredIds = familyFilteredModules.map(({ id }) => id);
    expect(familyFilteredIds).toContain(fpaModules[0]!.id);
    expect(familyFilteredIds).toContain(fpaModules[1]!.id);
    expect(familyFilteredIds).not.toContain(fpaModules[2]!.id);

    const provinceId = await createProvince("Centro activo FP Adaptada sin oferta");
    const centerId = await createCenter(provinceId);
    const teacher = await createUser({ role: "teacher", provinceId, centerId });
    expect(await db.select().from(trainingOfferTable).where(eq(trainingOfferTable.centerId, centerId))).toHaveLength(0);
    const response = await request(app)
      .get("/api/auth/me/teaching-profile")
      .query({ targetCenterId: centerId })
      .set(authHeader(teacher.token));
    expect(response.status).toBe(200);
    expect(response.body.targetCenterId).toBe(centerId);
    const listedIds = response.body.modules.map((module: { id: number }) => module.id);
    expect(listedIds).toContain(fpaModules[0]!.id);
    expect(listedIds).toContain(fpaModules[1]!.id);
    expect(listedIds).not.toContain(fpaModules[2]!.id);
    expect(fpaModules.slice(0, 2).every((module) => module.centerId === null)).toBe(true);
    expect(await db.select().from(modulesTable).where(and(
      inArray(modulesTable.id, fpaModules.slice(0, 2).map(({ id }) => id)),
      isNull(modulesTable.deletedAt),
    ))).toHaveLength(2);
  } finally {
    if (createdSettings) {
      await db.delete(integrationSettingsTable).where(eq(integrationSettingsTable.id, activeSettings.id));
    } else {
      await db.update(integrationSettingsTable)
        .set({ professionalFamily: previousFamily })
        .where(eq(integrationSettingsTable.id, activeSettings.id));
    }
  }
});

it("no recrea itinerarios ni módulos eliminados al sembrar el catálogo", async () => {
  const marker = `${Date.now()}-${Math.random()}`;
  const deletedCycleName = `Itinerario FPA eliminado ${marker}`;
  const activeCycleName = `Itinerario FPA activo ${marker}`;
  const deletedModuleName = `Módulo FPA eliminado ${marker}`;
  const isolatedCatalog: FpaCatalog = {
    family: catalog.family,
    level: catalog.level,
    reviewedAt: "test",
    resolution: "test",
    totalHours: 0,
    weeklyHours: 0,
    commonModules: [],
    itineraries: [
      {
        name: deletedCycleName,
        qualificationCode: "test",
        certificateCode: `DELETED-${marker}`,
        source: "test",
        modules: [{ name: "No recrear para ciclo eliminado", code: null, hours: 0, weeklyHours: 0, kind: "professional" }],
      },
      {
        name: activeCycleName,
        qualificationCode: "test",
        certificateCode: `ACTIVE-${marker}`,
        source: "test",
        modules: [{ name: deletedModuleName, code: null, hours: 0, weeklyHours: 0, kind: "professional" }],
      },
    ],
  };
  const rollback = new Error("Rollback isolated FPA seed fixtures");
  await expect(db.transaction(async (tx) => {
    const [deletedCycle] = await tx.insert(cyclesTable).values({
      name: deletedCycleName, code: `DELETED-${marker}`, level: catalog.level, deletedAt: new Date(),
    }).returning();
    const [activeCycle] = await tx.insert(cyclesTable).values({
      name: activeCycleName, code: `ACTIVE-${marker}`, level: catalog.level,
    }).returning();
    const [deletedModule] = await tx.insert(modulesTable).values({
      name: deletedModuleName,
      cycleId: activeCycle!.id,
      cycleName: activeCycleName,
      centerId: null,
      deletedAt: new Date(),
    }).returning();

    const stats = await seedFpaCatalog(tx, isolatedCatalog);
    expect(stats.skipped).toBeGreaterThanOrEqual(2);
    expect(await tx.select().from(cyclesTable).where(eq(cyclesTable.id, deletedCycle!.id))).toHaveLength(1);
    expect(await tx.select().from(modulesTable).where(eq(modulesTable.id, deletedModule!.id))).toHaveLength(1);
    expect(await tx.select().from(modulesTable).where(and(
      eq(modulesTable.cycleId, deletedCycle!.id),
      isNull(modulesTable.deletedAt),
    ))).toHaveLength(0);
    expect(await tx.select().from(modulesTable).where(and(
      eq(modulesTable.cycleId, activeCycle!.id),
      eq(modulesTable.name, deletedModuleName),
      isNull(modulesTable.deletedAt),
    ))).toHaveLength(0);
    throw rollback;
  })).rejects.toBe(rollback);
});

it("aplica el filtro familiar también a los módulos globales, sin oferta local", async () => {
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
