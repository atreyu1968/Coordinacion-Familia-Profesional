import {
  db,
  usersTable,
  provincesTable,
  centersTable,
  chatGroupsTable,
  chatGroupMembersTable,
  messagesTable,
  notificationsTable,
  pushTokensTable,
  surveysTable,
  surveyQuestionsTable,
  surveyResponsesTable,
  surveyAnswersTable,
  modulesTable,
  moduleMembershipsTable,
  meetingsTable,
  forumThreadsTable,
  forumPostsTable,
  forumThreadReadsTable,
  passwordResetTokensTable,
  academicYearsTable,
  teacherYearConfirmationsTable,
  teachingAssignmentsTable,
  groupsTable,
  trainingOfferTable,
  type User,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import { hashPassword, signToken } from "../src/lib/auth";

// A unique tag for this test run so seeded rows are easy to identify and never
// collide with other data in the shared database.
const RUN_TAG = `vitest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

type Role = User["role"];

// Track every row we create so cleanup() can remove them in FK-safe order.
const created = {
  userIds: [] as number[],
  provinceIds: [] as number[],
  centerIds: [] as number[],
  groupIds: [] as number[],
  surveyIds: [] as number[],
  moduleIds: [] as number[],
  threadIds: [] as number[],
  meetingIds: [] as number[],
  academicYearIds: [] as number[],
  schoolYears: [] as string[],
};

let userSeq = 0;

export const DEFAULT_PASSWORD = "Sup3rSecret!";

export async function createProvince(name = "Provincia"): Promise<number> {
  const [row] = await db
    .insert(provincesTable)
    .values({ name: `${name} ${RUN_TAG}`, code: null })
    .returning();
  created.provinceIds.push(row!.id);
  return row!.id;
}

export async function createCenter(provinceId: number): Promise<number> {
  const [row] = await db
    .insert(centersTable)
    .values({ name: `Centro ${RUN_TAG}`, provinceId })
    .returning();
  created.centerIds.push(row!.id);
  return row!.id;
}

export interface SeedUserOptions {
  role?: Role;
  provinceId?: number | null;
  centerId?: number | null;
  name?: string;
  password?: string;
  status?: string;
}

export interface SeededUser {
  user: User;
  token: string;
  password: string;
  email: string;
}

export async function createUser(
  opts: SeedUserOptions = {},
): Promise<SeededUser> {
  const password = opts.password ?? DEFAULT_PASSWORD;
  const passwordHash = await hashPassword(password);
  userSeq += 1;
  const email = `${RUN_TAG}-u${userSeq}@example.test`;
  const [user] = await db
    .insert(usersTable)
    .values({
      name: opts.name ?? `User ${userSeq}`,
      email,
      passwordHash,
      role: opts.role ?? "teacher",
      status: opts.status ?? "active",
      provinceId: opts.provinceId ?? null,
      centerId: opts.centerId ?? null,
    })
    .returning();
  created.userIds.push(user!.id);
  const token = signToken({ sub: user!.id, role: user!.role });
  return { user: user!, token, password, email };
}

export function trackGroup(id: number): void {
  created.groupIds.push(id);
}

export async function createModule(opts: {
  centerId?: number | null;
  cycleName?: string | null;
  code?: string | null;
  name?: string;
} = {}): Promise<number> {
  const [row] = await db
    .insert(modulesTable)
    .values({
      name: opts.name ?? `Módulo ${RUN_TAG}`,
      code: opts.code ?? null,
      cycleName: opts.cycleName ?? `Ciclo ${RUN_TAG}`,
      centerId: opts.centerId ?? null,
    })
    .returning();
  created.moduleIds.push(row!.id);
  return row!.id;
}

// Enroll a user into a module's collaboration space (member or coordinator).
export async function addMembership(
  moduleId: number,
  userId: number,
  role: "member" | "coordinator" = "member",
): Promise<void> {
  await db
    .insert(moduleMembershipsTable)
    .values({ moduleId, userId, role });
}

// Create a meeting row directly (optionally tied to a module / host).
export async function createMeeting(opts: {
  roomName: string;
  hostId: number;
  moduleId?: number | null;
  title?: string;
}): Promise<number> {
  const [row] = await db
    .insert(meetingsTable)
    .values({
      title: opts.title ?? `Reunión ${RUN_TAG}`,
      roomName: opts.roomName,
      hostId: opts.hostId,
      moduleId: opts.moduleId ?? null,
    })
    .returning();
  created.meetingIds.push(row!.id);
  return row!.id;
}

export function trackThread(id: number): void {
  created.threadIds.push(id);
}

export function trackSurvey(id: number): void {
  created.surveyIds.push(id);
}

// Register an official academic year (curso). Tracked so cleanup removes it.
export async function createAcademicYear(name: string): Promise<number> {
  const [row] = await db
    .insert(academicYearsTable)
    .values({ name })
    .returning();
  created.academicYearIds.push(row!.id);
  created.schoolYears.push(name);
  return row!.id;
}

// Track a free-text school year so confirmations/assignments/groups/offer rows
// tagged with it are removed during cleanup, even when seeded for other users.
export function trackSchoolYear(year: string): void {
  created.schoolYears.push(year);
}

export async function createGroup(opts: {
  centerId: number;
  name: string;
  cycleName?: string | null;
  schoolYear: string;
}): Promise<number> {
  trackSchoolYear(opts.schoolYear);
  const [row] = await db
    .insert(groupsTable)
    .values({
      centerId: opts.centerId,
      name: opts.name,
      cycleName: opts.cycleName ?? null,
      schoolYear: opts.schoolYear,
    })
    .returning();
  return row!.id;
}

export async function createTrainingOffer(opts: {
  centerId: number;
  cycleName: string;
  shift?: string | null;
  level?: string | null;
  schoolYear: string;
}): Promise<number> {
  trackSchoolYear(opts.schoolYear);
  const [row] = await db
    .insert(trainingOfferTable)
    .values({
      centerId: opts.centerId,
      cycleName: opts.cycleName,
      shift: opts.shift ?? null,
      level: opts.level ?? null,
      schoolYear: opts.schoolYear,
    })
    .returning();
  return row!.id;
}

export async function createTeachingAssignment(opts: {
  teacherId: number;
  moduleId: number;
  centerId: number;
  groupId?: number | null;
  schoolYear: string;
}): Promise<number> {
  trackSchoolYear(opts.schoolYear);
  const [row] = await db
    .insert(teachingAssignmentsTable)
    .values({
      teacherId: opts.teacherId,
      moduleId: opts.moduleId,
      centerId: opts.centerId,
      groupId: opts.groupId ?? null,
      schoolYear: opts.schoolYear,
    })
    .returning();
  return row!.id;
}

// Insert a teacher year confirmation row directly (bypassing the open-window
// route so a single teacher can be set up with a controlled deadline/status).
export async function createYearConfirmation(opts: {
  teacherId: number;
  schoolYear: string;
  status?: string;
  deadline: Date;
  centerId?: number | null;
  confirmedAt?: Date | null;
}): Promise<number> {
  trackSchoolYear(opts.schoolYear);
  const [row] = await db
    .insert(teacherYearConfirmationsTable)
    .values({
      teacherId: opts.teacherId,
      schoolYear: opts.schoolYear,
      status: opts.status ?? "pending",
      deadline: opts.deadline,
      centerId: opts.centerId ?? null,
      confirmedAt: opts.confirmedAt ?? null,
    })
    .returning();
  return row!.id;
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// Remove every row created during the test run. Order matters because the
// schema uses logical (not enforced) foreign keys, but we delete children
// first anyway to keep things tidy.
export async function cleanup(): Promise<void> {
  if (created.userIds.length > 0) {
    await db
      .delete(teachingAssignmentsTable)
      .where(inArray(teachingAssignmentsTable.teacherId, created.userIds));
    await db
      .delete(teacherYearConfirmationsTable)
      .where(inArray(teacherYearConfirmationsTable.teacherId, created.userIds));
  }
  if (created.centerIds.length > 0) {
    await db
      .delete(teachingAssignmentsTable)
      .where(inArray(teachingAssignmentsTable.centerId, created.centerIds));
    await db
      .delete(groupsTable)
      .where(inArray(groupsTable.centerId, created.centerIds));
    await db
      .delete(trainingOfferTable)
      .where(inArray(trainingOfferTable.centerId, created.centerIds));
  }
  if (created.schoolYears.length > 0) {
    await db
      .delete(teacherYearConfirmationsTable)
      .where(inArray(teacherYearConfirmationsTable.schoolYear, created.schoolYears));
  }
  if (created.academicYearIds.length > 0) {
    await db
      .delete(academicYearsTable)
      .where(inArray(academicYearsTable.id, created.academicYearIds));
  }
  if (created.threadIds.length > 0) {
    await db
      .delete(forumThreadReadsTable)
      .where(inArray(forumThreadReadsTable.threadId, created.threadIds));
    await db
      .delete(forumPostsTable)
      .where(inArray(forumPostsTable.threadId, created.threadIds));
    await db
      .delete(forumThreadsTable)
      .where(inArray(forumThreadsTable.id, created.threadIds));
  }
  if (created.meetingIds.length > 0) {
    await db
      .delete(meetingsTable)
      .where(inArray(meetingsTable.id, created.meetingIds));
  }
  if (created.moduleIds.length > 0) {
    await db
      .delete(moduleMembershipsTable)
      .where(inArray(moduleMembershipsTable.moduleId, created.moduleIds));
    await db
      .delete(modulesTable)
      .where(inArray(modulesTable.id, created.moduleIds));
  }
  if (created.surveyIds.length > 0) {
    await db
      .delete(surveyAnswersTable)
      .where(inArray(surveyAnswersTable.surveyId, created.surveyIds));
    await db
      .delete(surveyResponsesTable)
      .where(inArray(surveyResponsesTable.surveyId, created.surveyIds));
    await db
      .delete(surveyQuestionsTable)
      .where(inArray(surveyQuestionsTable.surveyId, created.surveyIds));
    await db
      .delete(surveysTable)
      .where(inArray(surveysTable.id, created.surveyIds));
  }
  if (created.groupIds.length > 0) {
    await db
      .delete(messagesTable)
      .where(inArray(messagesTable.groupId, created.groupIds));
    await db
      .delete(chatGroupMembersTable)
      .where(inArray(chatGroupMembersTable.groupId, created.groupIds));
    await db
      .delete(chatGroupsTable)
      .where(inArray(chatGroupsTable.id, created.groupIds));
  }
  if (created.userIds.length > 0) {
    await db
      .delete(passwordResetTokensTable)
      .where(inArray(passwordResetTokensTable.userId, created.userIds));
    await db
      .delete(notificationsTable)
      .where(inArray(notificationsTable.userId, created.userIds));
    await db
      .delete(pushTokensTable)
      .where(inArray(pushTokensTable.userId, created.userIds));
    await db
      .delete(messagesTable)
      .where(inArray(messagesTable.senderId, created.userIds));
    await db
      .delete(usersTable)
      .where(inArray(usersTable.id, created.userIds));
  }
  if (created.centerIds.length > 0) {
    await db
      .delete(centersTable)
      .where(inArray(centersTable.id, created.centerIds));
  }
  if (created.provinceIds.length > 0) {
    await db
      .delete(provincesTable)
      .where(inArray(provincesTable.id, created.provinceIds));
  }
  created.userIds.length = 0;
  created.provinceIds.length = 0;
  created.centerIds.length = 0;
  created.groupIds.length = 0;
  created.surveyIds.length = 0;
  created.moduleIds.length = 0;
  created.threadIds.length = 0;
  created.meetingIds.length = 0;
  created.academicYearIds.length = 0;
  created.schoolYears.length = 0;
}
