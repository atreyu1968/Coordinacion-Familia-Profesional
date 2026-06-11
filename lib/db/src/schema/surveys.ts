import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// A survey or an agreement vote. `type` distinguishes a multi-question survey
// from a single-decision vote; both share the same machinery.
export const surveysTable = pgTable("surveys", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull(), // survey | vote
  anonymous: boolean("anonymous").notNull().default(false),
  status: text("status").notNull().default("draft"), // draft | open | closed
  provinceId: integer("province_id"),
  // Recipient/audience targeting. audienceType: all | province | island |
  // center | module | users. audienceIds holds the target ids for the chosen
  // type (province/island/center/module ids, or user ids for "users"); empty
  // for "all".
  audienceType: text("audience_type").notNull().default("all"),
  audienceIds: integer("audience_ids").array(),
  opensAt: timestamp("opens_at", { withTimezone: true }),
  closesAt: timestamp("closes_at", { withTimezone: true }),
  createdById: integer("created_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const surveyQuestionsTable = pgTable("survey_questions", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull(),
  text: text("text").notNull(),
  type: text("type").notNull(), // single | multiple | text | scale
  options: text("options").array(),
  order: integer("order").notNull().default(0),
});

// Participation marker: records THAT a user responded to a survey so we can
// prevent double-voting and compute `hasVoted`. Crucially, for anonymous
// surveys this row is NOT linked to the answer content (see surveyAnswers),
// guaranteeing real anonymity — we know the user voted, never what they chose.
export const surveyResponsesTable = pgTable(
  "survey_responses",
  {
    id: serial("id").primaryKey(),
    surveyId: integer("survey_id").notNull(),
    userId: integer("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqUserPerSurvey: unique().on(t.surveyId, t.userId),
  }),
);

// Actual answer content. `responseId` links an answer back to the participation
// marker (and therefore the user) ONLY for non-anonymous surveys. For anonymous
// surveys `responseId` is NULL so there is no DB-level path from a user to their
// answers — anonymity holds even against an operator inspecting the database.
export const surveyAnswersTable = pgTable("survey_answers", {
  id: serial("id").primaryKey(),
  surveyId: integer("survey_id").notNull(),
  questionId: integer("question_id").notNull(),
  responseId: integer("response_id"),
  value: text("value").array().notNull(),
  // Nullable on purpose: for anonymous surveys we store NULL here so there is no
  // per-answer timestamp that could be correlated with `survey_responses`
  // timestamps to re-link a user to their answers. Non-anonymous answers keep a
  // timestamp for auditing.
  createdAt: timestamp("created_at", { withTimezone: true }),
});

export type Survey = typeof surveysTable.$inferSelect;
export type InsertSurvey = typeof surveysTable.$inferInsert;
export type SurveyQuestion = typeof surveyQuestionsTable.$inferSelect;
export type SurveyResponse = typeof surveyResponsesTable.$inferSelect;
export type SurveyAnswer = typeof surveyAnswersTable.$inferSelect;
