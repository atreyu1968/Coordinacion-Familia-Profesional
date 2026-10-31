import { afterAll, expect, it } from "vitest";
import request from "supertest";
import { db, chatGroupsTable, chatGroupMembersTable, moduleMembershipsTable, syncModuleChatGroup, trainingOfferTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import app from "../src/app";
import { getActiveAcademicYear } from "../src/lib/settings";
import { authHeader, cleanup, createCenter, createModule, createProvince, createTeachingAssignment, createUser, trackGroup } from "./helpers";

afterAll(cleanup);

it("limits heads to current teaching assignments, not their management center or stale memberships", async () => {
  const province = await createProvince();
  const managementCenter = await createCenter(province);
  const personalCenter = await createCenter(province);
  const head = await createUser({ role: "department_head", centerId: managementCenter, provinceId: province });
  await db.update(usersTable).set({ teachingCenterId: personalCenter }).where(eq(usersTable.id, head.user.id));
  const year = await getActiveAcademicYear();
  const assigned = await createModule({ centerId: personalCenter });
  const globalCycle = `Ciclo global de prueba ${head.user.id}`;
  const globalAssigned = await createModule({ cycleName: globalCycle });
  await db.insert(trainingOfferTable).values({
    centerId: personalCenter, cycleName: globalCycle, schoolYear: year,
  });
  const notAssigned = await createModule({ centerId: personalCenter });
  const managedOnly = await createModule({ centerId: managementCenter });
  const priorYear = await createModule({ centerId: personalCenter });
  for (const moduleId of [assigned, globalAssigned]) {
    await createTeachingAssignment({ teacherId: head.user.id, centerId: personalCenter, moduleId, schoolYear: year ?? "Prueba sin curso activo" });
  }
  await createTeachingAssignment({ teacherId: head.user.id, centerId: personalCenter, moduleId: priorYear, schoolYear: "1900-1901" });
  // Old membership/moderation records must not bypass the new teaching policy.
  await db.insert(moduleMembershipsTable).values({
    moduleId: notAssigned, userId: head.user.id, role: "coordinator", forumModerator: true,
  });

  const headers = authHeader(head.token);
  const modules = await request(app).get("/api/modules").set(headers);
  expect(modules.status).toBe(200);
  const visible = modules.body.map((row: { id: number }) => row.id);
  expect(visible).toContain(assigned);
  expect(visible).toContain(globalAssigned);
  expect(visible).not.toContain(notAssigned);
  expect(visible).not.toContain(managedOnly);
  if (year) expect(visible).not.toContain(priorYear);
  const forums = await request(app).get("/api/forum/modules").set(headers);
  expect(forums.status).toBe(200);
  const forumIds = forums.body.map((row: { id: number }) => row.id);
  expect(forumIds).toContain(assigned);
  expect(forumIds).not.toContain(notAssigned);
  expect(forumIds).not.toContain(managedOnly);
  if (year) expect(forumIds).not.toContain(priorYear);
  for (const moduleId of [notAssigned, managedOnly]) {
    for (const suffix of ["members", "learning-outcomes"]) {
      const response = await request(app).get(`/api/modules/${moduleId}/${suffix}`).set(headers);
      expect(response.status).toBe(403);
    }
    const enrollment = await request(app).post(`/api/modules/${moduleId}/enroll`).set(headers);
    expect(enrollment.status).toBe(403);
    const history = await request(app).get(`/api/forum/modules/${moduleId}/moderation-history`).set(headers);
    expect(history.status).toBe(403);
  }
  for (const suffix of ["members", "learning-outcomes"]) {
    const response = await request(app).get(`/api/modules/${assigned}/${suffix}`).set(headers);
    expect(response.status).toBe(200);
  }
  // Profile completion must still offer unassigned modules for the selected center.
  const profile = await request(app).get("/api/auth/me/teaching-profile")
    .query({ targetCenterId: personalCenter }).set(headers);
  expect(profile.status).toBe(200);
  expect(profile.body.modules.some((row: { id: number }) => row.id === notAssigned)).toBe(true);
});

it("includes heads in assigned module chats only and removes stale management membership when synchronizing", async () => {
  const province = await createProvince();
  const centerId = await createCenter(province);
  const head = await createUser({ role: "department_head", centerId, provinceId: province });
  const colleague = await createUser({ centerId, provinceId: province });
  const otherColleague = await createUser({ centerId, provinceId: province });
  const ownModule = await createModule({ centerId });
  const otherModule = await createModule({ centerId });
  const schoolYear = await getActiveAcademicYear() ?? "Prueba sin curso activo";
  await createTeachingAssignment({ teacherId: head.user.id, centerId, moduleId: ownModule, schoolYear });
  await createTeachingAssignment({ teacherId: colleague.user.id, centerId, moduleId: ownModule, schoolYear });
  await createTeachingAssignment({ teacherId: colleague.user.id, centerId, moduleId: otherModule, schoolYear });
  await createTeachingAssignment({ teacherId: otherColleague.user.id, centerId, moduleId: otherModule, schoolYear });
  await syncModuleChatGroup(ownModule);
  await syncModuleChatGroup(otherModule);
  const groups = await db.select().from(chatGroupsTable)
    .where(inArray(chatGroupsTable.moduleId, [ownModule, otherModule]));
  expect(groups).toHaveLength(2);
  for (const group of groups) trackGroup(group.id);
  const otherGroup = groups.find((group) => group.moduleId === otherModule)!;
  await db.insert(chatGroupMembersTable).values({ groupId: otherGroup.id, userId: head.user.id }).onConflictDoNothing();
  await syncModuleChatGroup(otherModule);
  const memberships = await db.select().from(chatGroupMembersTable)
    .where(eq(chatGroupMembersTable.userId, head.user.id));
  const ownGroup = groups.find((group) => group.moduleId === ownModule)!;
  expect(memberships.some((row) => row.groupId === ownGroup.id)).toBe(true);
  expect(memberships.some((row) => row.groupId === otherGroup.id)).toBe(false);
});
