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

    const createOutsideCycle = await request(app)
      .post("/api/cycles")
      .set(authHeader(admin.token))
      .send({ name: `Ciclo fuera de familia ${suffix}`, centerId: otherCenterId });
    expect(createOutsideCycle.status).toBe(404);

    const updateOutsideCycle = await request(app)
      .patch(`/api/cycles/${otherCycle!.id}`)
      .set(authHeader(admin.token))
      .send({ name: `Ciclo cambiado ${suffix}` });
    expect(updateOutsideCycle.status).toBe(404);

    const createOutsideModule = await request(app)
      .post("/api/modules")
      .set(authHeader(admin.token))
      .send({
        name: `Módulo fuera de familia ${suffix}`,
        cycleId: otherCycle!.id,
        centerId: null,
      });
    expect(createOutsideModule.status).toBe(400);

    const updateOutsideModule = await request(app)
      .patch(`/api/modules/${otherModule!.id}`)
      .set(authHeader(admin.token))
      .send({ name: `Módulo cambiado ${suffix}` });
    expect(updateOutsideModule.status).toBe(404);

    const addOutsideOffer = await request(app)
      .post(`/api/centers/${activeCenterId}/training-offer`)
      .set(authHeader(admin.token))
      .send({ cycleId: otherCycle!.id });
    expect(addOutsideOffer.status).toBe(404);

    const createActiveCycle = await request(app)
      .post("/api/cycles")
      .set(authHeader(admin.token))
      .send({
        name: `Nuevo ciclo activo ${suffix}`,
        level: "Grado Superior",
        centerId: activeCenterId,
      });
    expect(createActiveCycle.status).toBe(201);
    const createdCycleId = createActiveCycle.body.id as number;
    cycleIds.push(createdCycleId);

    const createActiveModule = await request(app)
      .post("/api/modules")
      .set(authHeader(admin.token))
      .send({
        name: `Nuevo módulo activo ${suffix}`,
        cycleId: createdCycleId,
        centerId: null,
      });
    expect(createActiveModule.status).toBe(201);
    moduleIds.push(createActiveModule.body.id as number);
  });
});