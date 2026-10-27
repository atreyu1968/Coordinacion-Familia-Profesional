import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Teacher membership of a module's collaboration space (forum + meetings).
// Separate from `teaching_assignments` (the academic timetable): a teacher
// self-enrolls here, and one member per module may be the module coordinator.
// `role` is "member" | "coordinator"; at most one "coordinator" per module is
// enforced in the route layer. Forum moderation is a separate per-member flag,
// so multiple moderators can be assigned without changing coordinator status.
// Leaving a module soft-deletes the row; re-joining reuses its unique slot.
export const moduleMembershipsTable = pgTable(
  "module_memberships",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull(),
    userId: integer("user_id").notNull(),
    role: text("role").notNull().default("member"), // member | coordinator
    forumModerator: boolean("forum_moderator").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    uniqUserPerModule: unique().on(t.moduleId, t.userId),
  }),
);

export type ModuleMembership = typeof moduleMembershipsTable.$inferSelect;
export type InsertModuleMembership =
  typeof moduleMembershipsTable.$inferInsert;
