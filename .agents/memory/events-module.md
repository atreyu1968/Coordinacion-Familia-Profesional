---
name: Events module contract & calendar mirror
description: Field-naming gotchas and calendar-mirror lifecycle for the events tag.
---

# Events module (Eventos y Protocolo)

The events-tag OpenAPI contract uses `name`, `type`, `startAt`, `endAt`, `location`,
`provinceId` for events — NOT `title`/`date`/`endDate`. When curl-testing event
creation, use `{"name", "type", "startAt", "endAt"}` or you get a zod
`name Required` 400.

**Why:** Easy to assume `title`/`date` (the calendar-entry shape) applies to events
and waste a debugging cycle on a false 400.

## Calendar mirror lifecycle
Creating an event auto-mirrors a row into `calendar_entries` (so it shows in the
unified `/calendar`). The calendar response exposes the **calendar entry's own
`id`** plus `title`/`date`/`endDate`/`type`/`provinceId`/`description` — it does NOT
expose `eventId`. So you cannot filter `/calendar` results by event id; match by
`title` instead.

**Rule:** Any event-lifecycle change must keep the mirror consistent. Deleting an
event (soft-delete `events.deletedAt`) must also delete its `calendar_entries` mirror
row (`where eventId = …`), or the deleted event lingers in the calendar and exports.

## Calendar sync (no third-party keys)
Google/Outlook sync is client-side: ICS download + `googleCalendarUrl()` /
`outlookCalendarUrl()` link builders. Keep Google AND Outlook parity in BOTH the
event-detail view and the unified calendar list.
