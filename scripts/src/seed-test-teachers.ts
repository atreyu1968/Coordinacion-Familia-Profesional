import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  usersTable,
  centersTable,
  cyclesTable,
  modulesTable,
  teachingAssignmentsTable,
  syncModuleChatGroup,
} from "@workspace/db";

// Seeds a handful of TEST teachers for the "Administración y Gestión"
// professional family and assigns each to the modules of one of its cycles.
//
// It is portable across environments (dev / production self-host): the center
// is resolved by name (falling back to any center offering the family), cycles
// by name+level and modules by their global-catalog rows, so the script does
// not depend on serial ids that differ between databases. It is idempotent:
// teachers are keyed by email and assignments by teacher+module+center+year,
// so re-running it never creates duplicates.
//
// Optional env:
//   TEST_TEACHER_PASSWORD     (default "Profesor2026!")
//   TEST_TEACHER_CENTER       center name (default "CIFP CÉSAR MANRIQUE")
//   TEST_TEACHER_SCHOOL_YEAR  (default "2025-2026")

const FAMILY = "Administración y Gestión";
const PASSWORD = process.env.TEST_TEACHER_PASSWORD || "Profesor2026!";
const CENTER_NAME = (
  process.env.TEST_TEACHER_CENTER || "CIFP CÉSAR MANRIQUE"
).trim();
const SCHOOL_YEAR = (process.env.TEST_TEACHER_SCHOOL_YEAR || "2025-2026").trim();

type CycleKey = { name: string; level: string };

const TEACHERS: { name: string; email: string; cycle: CycleKey }[] = [
  {
    name: "Ana García (Profesora de prueba)",
    email: "ana.garcia@admin.coordina.test",
    cycle: { name: "Técnico en Gestión Administrativa", level: "Grado Medio" },
  },
  {
    name: "Bruno López (Profesor de prueba)",
    email: "bruno.lopez@admin.coordina.test",
    cycle: { name: "Técnico en Gestión Administrativa", level: "Grado Medio" },
  },
  {
    name: "Carmen Ruiz (Profesora de prueba)",
    email: "carmen.ruiz@admin.coordina.test",
    cycle: {
      name: "Técnico Superior en Administración y Finanzas",
      level: "Grado Superior",
    },
  },
  {
    name: "David Sánchez (Profesor de prueba)",
    email: "david.sanchez@admin.coordina.test",
    cycle: {
      name: "Técnico Superior en Asistencia a la Dirección",
      level: "Grado Superior",
    },
  },
];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const stats = { teachersCreated: 0, teachersExisting: 0, assignments: 0 };
  // Modules that ended up with seeded teachers — their auto-managed module
  // chat groups are synced AFTER the transaction commits (syncModuleChatGroup
  // reads committed rows through its own connection).
  const affectedModuleIds = new Set<number>();

  await db.transaction(async (tx) => {
    // 1) Resolve the target center (by name, else any with the family).
    const [byName] = await tx
      .select({
        id: centersTable.id,
        name: centersTable.name,
        provinceId: centersTable.provinceId,
      })
      .from(centersTable)
      .where(and(eq(centersTable.name, CENTER_NAME), isNull(centersTable.deletedAt)))
      .limit(1);

    let center = byName;
    if (!center) {
      const [anyCenter] = await tx
        .select({
          id: centersTable.id,
          name: centersTable.name,
          provinceId: centersTable.provinceId,
        })
        .from(centersTable)
        .where(
          and(
            isNull(centersTable.deletedAt),
            sql`${centersTable.families} @> ${JSON.stringify([FAMILY])}::jsonb`,
          ),
        )
        .orderBy(centersTable.name)
        .limit(1);
      center = anyCenter;
    }
    if (!center) {
      throw new Error(
        `No center found offering "${FAMILY}". Seed reference data first.`,
      );
    }
    console.log(`Target center: ${center.name} (id ${center.id}).`);

    // 2) Upsert teachers (key: email).
    for (const t of TEACHERS) {
      const email = t.email.toLowerCase();
      const [existing] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);

      let teacherId: number;
      if (existing) {
        teacherId = existing.id;
        stats.teachersExisting++;
      } else {
        const [row] = await tx
          .insert(usersTable)
          .values({
            name: t.name,
            email,
            passwordHash,
            role: "teacher",
            status: "active",
            provinceId: center.provinceId,
            centerId: center.id,
          })
          .returning({ id: usersTable.id });
        teacherId = row.id;
        stats.teachersCreated++;
      }

      // 3) Resolve the teacher's cycle + its global-catalog modules.
      const [cycle] = await tx
        .select({ id: cyclesTable.id })
        .from(cyclesTable)
        .where(
          and(
            eq(cyclesTable.name, t.cycle.name),
            eq(cyclesTable.level, t.cycle.level),
          ),
        )
        .limit(1);
      if (!cycle) {
        console.warn(
          `  Cycle not found: "${t.cycle.name}" (${t.cycle.level}) — skipping assignments for ${email}.`,
        );
        continue;
      }
      const mods = await tx
        .select({ id: modulesTable.id })
        .from(modulesTable)
        .where(
          and(
            eq(modulesTable.cycleId, cycle.id),
            isNull(modulesTable.centerId),
          ),
        );

      // 4) Upsert teaching assignments (key: teacher+module+center+year).
      for (const m of mods) {
        affectedModuleIds.add(m.id);
        const [a] = await tx
          .select({ id: teachingAssignmentsTable.id })
          .from(teachingAssignmentsTable)
          .where(
            and(
              eq(teachingAssignmentsTable.teacherId, teacherId),
              eq(teachingAssignmentsTable.moduleId, m.id),
              eq(teachingAssignmentsTable.centerId, center.id),
              eq(teachingAssignmentsTable.schoolYear, SCHOOL_YEAR),
              isNull(teachingAssignmentsTable.deletedAt),
            ),
          )
          .limit(1);
        if (a) continue;
        await tx.insert(teachingAssignmentsTable).values({
          teacherId,
          moduleId: m.id,
          centerId: center.id,
          schoolYear: SCHOOL_YEAR,
        });
        stats.assignments++;
      }
    }
  });

  // Create/sync the auto-managed module chat group for every touched module so
  // the seeded teachers get their "grupos de mensajes por módulo" — mirroring
  // what the API does when an assignment is created through the normal flow.
  const groupStats = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
  for (const moduleId of affectedModuleIds) {
    try {
      groupStats[await syncModuleChatGroup(moduleId)]++;
    } catch (err) {
      console.error(`  syncModuleChatGroup failed for module ${moduleId}:`, err);
    }
  }

  console.log(
    `Test teachers ready — created: ${stats.teachersCreated}, existing: ${stats.teachersExisting}, new assignments: ${stats.assignments}.`,
  );
  console.log(
    `Module chat groups — created: ${groupStats.created}, updated: ${groupStats.updated}, unchanged: ${groupStats.unchanged}, skipped: ${groupStats.skipped}.`,
  );
  console.log(
    `Login: ${TEACHERS.map((t) => t.email).join(", ")} — password: ${PASSWORD}`,
  );
}

main()
  .catch((err) => {
    console.error("Failed to seed test teachers:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
