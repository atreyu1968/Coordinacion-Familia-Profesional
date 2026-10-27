import { pgTable, serial, text, timestamp, integer, date, uniqueIndex } from "drizzle-orm/pg-core";

// The monitor never writes wiki_pages: these are review candidates, not law in force.
export const normativaPublicationsTable = pgTable("normativa_publications", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  officialId: text("official_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  publishedAt: date("published_at", { mode: "string" }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  relevance: text("relevance").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  reviewNote: text("review_note").notNull().default(""),
  reviewedBy: integer("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("normativa_publications_official_unique").on(t.source, t.officialId)]);

export const normativaSourcesTable = pgTable("normativa_sources", {
  source: text("source").primaryKey(),
  startedFrom: date("started_from", { mode: "string" }).notNull(),
  coveredThrough: date("covered_through", { mode: "string" }),
  attemptedAt: timestamp("attempted_at", { withTimezone: true }),
  succeededAt: timestamp("succeeded_at", { withTimezone: true }),
  error: text("error"),
});
