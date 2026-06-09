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

export function trackSurvey(id: number): void {
  created.surveyIds.push(id);
}

export function authHeader(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

// Remove every row created during the test run. Order matters because the
// schema uses logical (not enforced) foreign keys, but we delete children
// first anyway to keep things tidy.
export async function cleanup(): Promise<void> {
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
}
