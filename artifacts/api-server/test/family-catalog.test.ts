import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";
import {
  db,
  centersTable,
  cyclesTable,
  integrationSettingsTable,
  modulesTable,
  trainingOfferTable,
} from "@workspace/db";
import app from "../src/app";
import {
  authHeader,
  cleanup,
  createCenter,
  createProvince,
  createUser,
} from "./helpers";

const cycleIds: number[] = [];
const moduleIds: number[] = [];

afterAll(async () => {
  if (moduleIds.length) {
    await db.delete(modulesTable).where(inArray(modulesTable.id, moduleIds));
  }
  if (cycleIds.length) {
    await db.delete(cyclesTable).where(inArray(cyclesTable.id, cycleIds));
  }
  await cleanup();
});

describe("professional-family catalog filters", () => {
  it("lists only cycles and modules offered within the configured family", async () => {
    const [settings] = await db
      .select({ professionalFamily: integrationSettingsTable.professionalFamily })
      .from(integrationSettingsTable)
      .limit(1);
    const family =
      settings?.professionalFamily?.trim() || "Administración y Gestión";
    const otherFamily = `${family} (otra familia)`;

    const provinceId = await createProvince("Catálogo familia activa");
    const activeCenterId = await createCenter(provinceId);
    const otherCenterId = await createCenter(provinceId);
    await db
      .update(centersTable)
      .set({ families: [family] })
      .where(eq(centersTable.id, activeCenterId));
    await db
      .update(centersTable)
      .set({ families: [otherFamily] })
      .where(eq(centersTable.id, otherCenterId));

    const suffix = `${Date.now()}-${Math.random()}`;
    const [activeCycle] = await db
      .insert(cyclesTable)
      .values({ name: `Ciclo familia activa ${suffix}` })
      .returning();
    const [otherCycle] = await db
      .insert(cyclesTable)
      .values({ name: `Ciclo otra familia ${suffix}` })
      .returning();
    cycleIds.push(activeCycle!.id, otherCycle!.id);

    const [activeModule] = await db
      .insert(modulesTable)
      .values({
        name: `Módulo familia activa ${suffix}`,
        cycleId: activeCycle!.id,
        cycleName: activeCycle!.name,
      })
      .returning();
    const [otherModule] = await db
      .insert(modulesTable)
      .values({
        name: `Módulo otra familia ${suffix}`,
        cycleId: otherCycle!.id,
        cycleName: otherCycle!.name,
      })
      .returning();
    moduleIds.push(activeModule!.id, otherModule!.id);

    await db.insert(trainingOfferTable).values([
      {
        centerId: activeCenterId,
        cycleId: activeCycle!.id,
        cycleName: activeCycle!.name,
        schoolYear: null,
      },
      {
        centerId: otherCenterId,
        cycleId: otherCycle!.id,
        cycleName: otherCycle!.name,
        schoolYear: null,
      },
    ]);

    const admin = await createUser({ role: "superadmin" });
    const [modules, cycles, activeCycleModules, otherCycleModules] =
      await Promise.all([
        request(app).get("/api/modules").set(authHeader(admin.token)),
        request(app).get("/api/cycles").set(authHeader(admin.token)),
        request(app)
          .get(`/api/cycles/${activeCycle!.id}/modules`)
          .set(authHeader(admin.token)),
        request(app)
          .get(`/api/cycles/${otherCycle!.id}/modules`)
          .set(authHeader(admin.token)),
      ]);

    expect(modules.status).toBe(200);
    expect(modules.body.some((module: { id: number }) => module.id === activeModule!.id)).toBe(true);
    expect(modules.body.some((module: { id: number }) => module.id === otherModule!.id)).toBe(false);

    expect(cycles.status).toBe(200);
    expect(cycles.body.some((cycle: { id: number }) => cycle.id === activeCycle!.id)).toBe(true);
    expect(cycles.body.some((cycle: { id: number }) => cycle.id === otherCycle!.id)).toBe(false);

    expect(activeCycleModules.status).toBe(200);
    expect(activeCycleModules.body.map((module: { id: number }) => module.id)).toContain(activeModule!.id);
    expect(otherCycleModules.status).toBe(200);
    expect(otherCycleModules.body).toEqual([]);
  });
});