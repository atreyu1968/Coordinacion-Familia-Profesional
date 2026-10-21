import { pgTable, serial, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const collaborativeSpacesTable = pgTable("collaborative_spaces", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: integer("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  provisioningStartedAt: timestamp("provisioning_started_at", { withTimezone: true }),
});

export const collaborativeSpaceMembersTable = pgTable("collaborative_space_members", {
  spaceId: integer("space_id").notNull().references(() => collaborativeSpacesTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.spaceId, table.userId] })]);
