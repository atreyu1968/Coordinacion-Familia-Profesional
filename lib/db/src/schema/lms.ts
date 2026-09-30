import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const lmsCoursesTable = pgTable("lms_courses", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  moduleId: integer("module_id"),
  status: text("status").notNull().default("draft"),
  certificateEnabled: boolean("certificate_enabled").notNull().default(true),
  createdBy: integer("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const lmsLessonsTable = pgTable("lms_lessons", {
  id: serial("id").primaryKey(),
  courseId: integer("course_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  position: integer("position").notNull().default(0),
  required: boolean("required").notNull().default(true),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  objectPath: text("object_path"),
  objectName: text("object_name"),
  objectContentType: text("object_content_type"),
  objectSize: integer("object_size"),
  scormVersion: text("scorm_version"),
  scormLaunchPath: text("scorm_launch_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const lmsCourseManagersTable = pgTable(
  "lms_course_managers",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    moduleId: integer("module_id"),
    isGeneral: boolean("is_general").notNull().default(false),
    grantedBy: integer("granted_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueGeneralUser: uniqueIndex("lms_course_managers_general_user_unique")
      .on(t.userId)
      .where(sql`${t.isGeneral} = true`),
    uniqueModuleUser: uniqueIndex("lms_course_managers_module_user_unique")
      .on(t.userId, t.moduleId)
      .where(sql`${t.isGeneral} = false`),
  }),
);

export const lmsLessonProgressTable = pgTable(
  "lms_lesson_progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    courseId: integer("course_id").notNull(),
    lessonId: integer("lesson_id").notNull(),
    status: text("status").notNull().default("not_started"),
    score: integer("score"),
    attempts: integer("attempts").notNull().default(0),
    cmiData: jsonb("cmi_data").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqueUserLesson: unique().on(t.userId, t.lessonId) }),
);

export const lmsCertificatesTable = pgTable(
  "lms_certificates",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    courseId: integer("course_id").notNull(),
    certificateNumber: text("certificate_number").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    objectPath: text("object_path"),
  },
  (t) => ({
    uniqueCourseUser: unique().on(t.courseId, t.userId),
    uniqueNumber: unique().on(t.certificateNumber),
  }),
);

export const lmsUploadIntentsTable = pgTable("lms_upload_intents", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: integer("user_id").notNull(),
  courseId: integer("course_id").notNull(),
  objectPath: text("object_path").notNull(),
  name: text("name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LmsCourse = typeof lmsCoursesTable.$inferSelect;
export type InsertLmsCourse = typeof lmsCoursesTable.$inferInsert;
export type LmsLesson = typeof lmsLessonsTable.$inferSelect;
export type InsertLmsLesson = typeof lmsLessonsTable.$inferInsert;
export type LmsCourseManager = typeof lmsCourseManagersTable.$inferSelect;
export type LmsLessonProgress = typeof lmsLessonProgressTable.$inferSelect;
export type LmsCertificate = typeof lmsCertificatesTable.$inferSelect;
export type LmsUploadIntent = typeof lmsUploadIntentsTable.$inferSelect;