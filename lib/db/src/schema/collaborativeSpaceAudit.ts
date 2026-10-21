import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { collaborativeSpacesTable } from "./collaborativeSpaces";

type Reference = { id: number; name: string };
export type SpaceAuditDetails = {
  selectedUsers: Reference[];
  selectedCenters: Reference[];
  affectedUsers: Reference[];
  changedFields: ("name" | "description")[];
  revocation: "not_applicable" | "not_required" | "completed" | "failed" | "configuration_missing";
  previousName?: string;
  newName?: string;
};

// No FK to accounts/centers: the identity and name snapshots must survive deletion
// or renaming. Never put request bodies, remote responses, or credentials here.
export const collaborativeSpaceAuditTable = pgTable("collaborative_space_audit", {
  id: serial("id").primaryKey(),
  spaceId: integer("space_id").notNull().references(() => collaborativeSpacesTable.id, { onDelete: "cascade" }),
  spaceName: text("space_name").notNull(),
  actorId: integer("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text("action", { enum: ["created", "updated", "members_added", "member_removed", "member_removal_failed"] }).notNull(),
  summary: text("summary").notNull(),
  details: jsonb("details").$type<SpaceAuditDetails>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("collaborative_space_audit_page_idx").on(table.spaceId, table.createdAt, table.id),
]);
