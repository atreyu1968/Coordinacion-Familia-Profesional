import { pgEnum } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", [
  "superadmin",
  "coordinator",
  "prospector",
  "department_head",
  "teacher",
  "student",
]);
