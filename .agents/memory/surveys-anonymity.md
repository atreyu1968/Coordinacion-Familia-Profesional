---
name: Survey/vote anonymity model
description: How anonymous surveys guarantee unlinkability at the DB level
---

Anonymous surveys must be unlinkable to the voter even against an operator with DB access.

**Rule:** For anonymous surveys, answer rows must carry NO correlatable metadata back to the participation marker:
- `survey_answers.responseId` = NULL (no FK to the user's response row)
- `survey_answers.createdAt` = NULL (a per-answer timestamp can be correlated with the `survey_responses` timestamp to re-link user → answers)
- `survey_responses` still stores `userId` + timestamp — this is the participation marker that enforces one-vote-per-user (UNIQUE(surveyId,userId)) and powers `hasVoted`. It records THAT a user voted, never WHAT.

Non-anonymous surveys keep both `responseId` and `createdAt` for auditing.

**Why:** Code review flagged that even with responseId NULL, correlatable timestamps defeat anonymity. Two same-transaction inserts produce near-identical timestamps.

**How to apply:** Any new field added to `survey_answers` must be evaluated for correlation risk before being populated on anonymous surveys.

## Audience & management authz
Surveys (like forms) target an audience: `audienceType` (all|province|island|center|module|users) + `audienceIds`. Creators: superadmin, provincial coordinator, module coordinators. Delete/manage authz uses `canManageAudience(caller, audienceType, audienceIds)` in `lib/audience.ts`, NOT the legacy `survey.provinceId`. See `document-forms-module.md` for the full rule and the why (create only mirrors provinceId for single-`province` audiences).
