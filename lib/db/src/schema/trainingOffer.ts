import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const trainingOfferTable = pgTable("training_offer", {
  id: serial("id").primaryKey(),
  centerId: integer("center_id").notNull(),
  cycleId: integer("cycle_id"),
  cycleName: text("cycle_name").notNull(),
  level: text("level"),
  shift: text("shift"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type TrainingOffer = typeof trainingOfferTable.$inferSelect;
export type InsertTrainingOffer = typeof trainingOfferTable.$inferInsert;
