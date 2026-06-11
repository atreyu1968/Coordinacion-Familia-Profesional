import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Teacher membership of a module's collaboration space (forum + meetings).
// Separate from `teaching_assignments` (the academic timetable): a teacher
// self-enrolls here, and one member per module may be the module coordinator.
// `role` is "member" | "coordinator"; at most one "coordinator" per module is
// enforced in the route layer. Leaving a module soft-deletes the row; re-joining
// reuses it (the unique (module_id, user_id) slot is kept), so enroll logic must
// upsert rather than blind-insert.
export const moduleMembershipsTable = pgTable(
  "module_memberships",
  {
    id: serial("id").primaryKey(),
    moduleId: integer("module_id").notNull(),
    userId: integer("user_id").notNull(),
    role: text("role").notNull().default("member"), // member | coordinator
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
