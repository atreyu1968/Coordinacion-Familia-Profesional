import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import request from "supertest";
import {
  db,
  teachingAssignmentsTable,
  teacherYearConfirmationsTable,
  groupsTable,
  trainingOfferTable,
  usersTable,
  integrationSettingsTable,
} from "@workspace/db";
import app from "../src/app";
import { getSettings } from "../src/lib/settings";
import { deactivateOverdueTeachers } from "../src/lib/scheduler";
import {
  createUser,
  createCenter,
  createProvince,
  createModule,
  createAcademicYear,
  createGroup,
  createTrainingOffer,
  createTeachingAssignment,
  createYearConfirmation,
  cleanup,
  authHeader,
} from "./helpers";

// A unique tag so the free-text school years we create never collide with the
// real cursos already stored in the shared database.
const TAG = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const FROM_YEAR = `vitest-from-${TAG}`;
const TO_YEAR = `vitest-to-${TAG}`;
const CONFIRM_YEAR = `vitest-confirm-${TAG}`;

const DAY_MS = 24 * 60 * 60 * 1000;

// The active course is a single global setting; snapshot it so mutating it in
// the confirm flow never leaks into the real configuration.
let originalActiveYear: string | null = null;

async function setActiveYear(name: string | null): Promise<void> {
  const settings = await getSettings();
  await db
    .update(integrationSettingsTable)
    .set({ activeAcademicYear: name })
    .where(eq(integrationSettingsTable.id, settings.id));
}

beforeAll(async () => {
  const settings = await getSettings();
  originalActiveYear = settings.activeAcademicYear ?? null;
});

afterAll(async () => {
  await setActiveYear(originalActiveYear);
  await cleanup();
});

describe("POST /api/academic-years/transition", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/academic-years/transition")
      .send({ fromYear: FROM_YEAR, toYear: TO_YEAR });
    expect(res.status).toBe(401);
  });

  it("rejects non-superadmin callers", async () => {
    const { token } = await createUser({ role: "coordinator" });
    const res = await request(app)
      .post("/api/academic-years/transition")
      .set(authHeader(token))
      .send({ fromYear: FROM_YEAR, toYear: TO_YEAR });
    expect(res.status).toBe(403);
  });

  it("404s when the destination year is not in the official list", async () => {
    const { token } = await createUser({ role: "superadmin" });
    const res = await request(app)
      .post("/api/academic-years/transition")
      .set(authHeader(token))
      .send({ fromYear: FROM_YEAR, toYear: `missing-${TAG}` });
    expect(res.status).toBe(404);
  });

  it("clones groups, training offer and assignments, and is idempotent", async () => {
    const { token } = await createUser({ role: "superadmin" });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const moduleId = await createModule({ centerId });
    const { user: teacher } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });

    // The destination course must exist in the official list.
    await createAcademicYear(TO_YEAR);

    // Seed source-year data.
    await createGroup({
      centerId,
      name: `Grupo ${TAG}`,
      cycleName: `Ciclo ${TAG}`,
      schoolYear: FROM_YEAR,
    });
    await createTrainingOffer({
      centerId,
      cycleName: `Ciclo ${TAG}`,
      shift: "morning",
      schoolYear: FROM_YEAR,
    });
    await createTeachingAssignment({
      teacherId: teacher.id,
      moduleId,
      centerId,
      schoolYear: FROM_YEAR,
    });

    const first = await request(app)
      .post("/api/academic-years/transition")
      .set(authHeader(token))
      .send({ fromYear: FROM_YEAR, toYear: TO_YEAR });
    expect(first.status).toBe(200);
    expect(first.body.groupsCopied).toBe(1);
    expect(first.body.offerCopied).toBe(1);
    expect(first.body.assignmentsCopied).toBe(1);

    // The destination year now holds clones of the seeded rows.
    const clonedGroups = await db
      .select()
      .from(groupsTable)
      .where(
        and(eq(groupsTable.centerId, centerId), eq(groupsTable.schoolYear, TO_YEAR)),
      );
    expect(clonedGroups).toHaveLength(1);
    const clonedOffer = await db
      .select()
      .from(trainingOfferTable)
      .where(
        and(
          eq(trainingOfferTable.centerId, centerId),
          eq(trainingOfferTable.schoolYear, TO_YEAR),
        ),
      );
    expect(clonedOffer).toHaveLength(1);
    const clonedAssignments = await db
      .select()
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.teacherId, teacher.id),
          eq(teachingAssignmentsTable.schoolYear, TO_YEAR),
        ),
      );
    expect(clonedAssignments).toHaveLength(1);

    // Re-running copies nothing more (idempotent) and leaves no duplicates.
    const second = await request(app)
      .post("/api/academic-years/transition")
      .set(authHeader(token))
      .send({ fromYear: FROM_YEAR, toYear: TO_YEAR });
    expect(second.status).toBe(200);
    expect(second.body.groupsCopied).toBe(0);
    expect(second.body.offerCopied).toBe(0);
    expect(second.body.assignmentsCopied).toBe(0);

    const groupsAfter = await db
      .select()
      .from(groupsTable)
      .where(
        and(eq(groupsTable.centerId, centerId), eq(groupsTable.schoolYear, TO_YEAR)),
      );
    expect(groupsAfter).toHaveLength(1);
    const assignmentsAfter = await db
      .select()
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.teacherId, teacher.id),
          eq(teachingAssignmentsTable.schoolYear, TO_YEAR),
        ),
      );
    expect(assignmentsAfter).toHaveLength(1);
  });
});

describe("POST /api/academic-years/open-confirmation", () => {
  it("creates pending confirmations for active teachers and is idempotent", async () => {
    const { token } = await createUser({ role: "superadmin" });
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const { user: teacher } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });

    const year = `vitest-open-${TAG}`;
    const first = await request(app)
      .post("/api/academic-years/open-confirmation")
      .set(authHeader(token))
      .send({ year, deadlineDays: 15 });
    expect(first.status).toBe(200);
    expect(first.body.created).toBeGreaterThanOrEqual(1);

    // Our seeded teacher has exactly one pending row with a future deadline.
    const rows = await db
      .select()
      .from(teacherYearConfirmationsTable)
      .where(
        and(
          eq(teacherYearConfirmationsTable.teacherId, teacher.id),
          eq(teacherYearConfirmationsTable.schoolYear, year),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("pending");
    expect(rows[0]!.deadline.getTime()).toBeGreaterThan(Date.now());

    // Re-opening the same year does not duplicate the teacher's row.
    const second = await request(app)
      .post("/api/academic-years/open-confirmation")
      .set(authHeader(token))
      .send({ year });
    expect(second.status).toBe(200);
    const rowsAfter = await db
      .select()
      .from(teacherYearConfirmationsTable)
      .where(
        and(
          eq(teacherYearConfirmationsTable.teacherId, teacher.id),
          eq(teacherYearConfirmationsTable.schoolYear, year),
        ),
      );
    expect(rowsAfter).toHaveLength(1);
  });
});

describe("POST /api/academic-years/confirm", () => {
  it("generates teaching assignments and confirms the row (idempotent)", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const moduleId = await createModule({ centerId });
    const { user: teacher, token } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });

    await createAcademicYear(CONFIRM_YEAR);
    await setActiveYear(CONFIRM_YEAR);
    await createYearConfirmation({
      teacherId: teacher.id,
      schoolYear: CONFIRM_YEAR,
      deadline: new Date(Date.now() + 15 * DAY_MS),
    });

    const res = await request(app)
      .post("/api/academic-years/confirm")
      .set(authHeader(token))
      .send({ centerId, moduleIds: [moduleId] });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("confirmed");
    expect(res.body.confirmedAt).toBeTruthy();

    const assignments = await db
      .select()
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.teacherId, teacher.id),
          eq(teachingAssignmentsTable.schoolYear, CONFIRM_YEAR),
          isNull(teachingAssignmentsTable.deletedAt),
        ),
      );
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.moduleId).toBe(moduleId);

    // Confirming again must not duplicate the assignment.
    const again = await request(app)
      .post("/api/academic-years/confirm")
      .set(authHeader(token))
      .send({ centerId, moduleIds: [moduleId] });
    expect(again.status).toBe(200);
    const assignmentsAfter = await db
      .select()
      .from(teachingAssignmentsTable)
      .where(
        and(
          eq(teachingAssignmentsTable.teacherId, teacher.id),
          eq(teachingAssignmentsTable.schoolYear, CONFIRM_YEAR),
          isNull(teachingAssignmentsTable.deletedAt),
        ),
      );
    expect(assignmentsAfter).toHaveLength(1);
  });

  it("409s when there is no open confirmation for the active course", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const { token } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });
    await setActiveYear(CONFIRM_YEAR);

    const res = await request(app)
      .post("/api/academic-years/confirm")
      .set(authHeader(token))
      .send({ centerId, moduleIds: [] });
    expect(res.status).toBe(409);
  });
});

describe("deactivateOverdueTeachers (scheduler)", () => {
  it("deactivates only active teachers with an overdue pending confirmation", async () => {
    const provinceId = await createProvince();
    const centerId = await createCenter(provinceId);
    const overdueYear = `vitest-overdue-${TAG}`;
    const past = new Date(Date.now() - DAY_MS);
    const future = new Date(Date.now() + 15 * DAY_MS);

    // Should be deactivated: active teacher, pending, deadline passed.
    const { user: overdueTeacher } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });
    await createYearConfirmation({
      teacherId: overdueTeacher.id,
      schoolYear: overdueYear,
      status: "pending",
      deadline: past,
    });

    // Should be left active: confirmed (even though overdue).
    const { user: confirmedTeacher } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });
    await createYearConfirmation({
      teacherId: confirmedTeacher.id,
      schoolYear: overdueYear,
      status: "confirmed",
      deadline: past,
      confirmedAt: new Date(),
    });

    // Should be left active: pending but deadline still in the future.
    const { user: pendingTeacher } = await createUser({
      role: "teacher",
      provinceId,
      centerId,
    });
    await createYearConfirmation({
      teacherId: pendingTeacher.id,
      schoolYear: overdueYear,
      status: "pending",
      deadline: future,
    });

    // Should be left active: overdue pending but NOT a teacher role.
    const { user: coordinator } = await createUser({
      role: "coordinator",
      provinceId,
      centerId,
    });
    await createYearConfirmation({
      teacherId: coordinator.id,
      schoolYear: overdueYear,
      status: "pending",
      deadline: past,
    });

    await deactivateOverdueTeachers();

    const statusOf = async (id: number): Promise<string> => {
      const [row] = await db
        .select({ status: usersTable.status })
        .from(usersTable)
        .where(eq(usersTable.id, id));
      return row!.status;
    };

    expect(await statusOf(overdueTeacher.id)).toBe("inactive");
    expect(await statusOf(confirmedTeacher.id)).toBe("active");
    expect(await statusOf(pendingTeacher.id)).toBe("active");
    expect(await statusOf(coordinator.id)).toBe("active");

    // Reactivation reopens the confirmation: the manager flips the account back
    // to active and a fresh pending window is opened with a new deadline.
    await db
      .update(usersTable)
      .set({ status: "active" })
      .where(eq(usersTable.id, overdueTeacher.id));
    await db
      .update(teacherYearConfirmationsTable)
      .set({ status: "pending", deadline: future, confirmedAt: null })
      .where(
        and(
          eq(teacherYearConfirmationsTable.teacherId, overdueTeacher.id),
          eq(teacherYearConfirmationsTable.schoolYear, overdueYear),
        ),
      );

    // A second scheduler pass must not re-deactivate the reopened teacher.
    await deactivateOverdueTeachers();
    expect(await statusOf(overdueTeacher.id)).toBe("active");
  });
});
