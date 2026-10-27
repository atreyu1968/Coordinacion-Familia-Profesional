// Only server-owned identifiers from known notification producers are persisted.
// A target is a navigation hint, never evidence of permission to read a resource.
const sources = {
  event: ["event", "eventId"],
  calendar: ["calendar", "calendarEntryId"],
  lms_course: ["course", "courseId"],
  message: ["chat", "groupId"],
  chat_group: ["chat", "groupId"],
  survey: ["survey", "surveyId"],
  document_form: ["form", "documentFormId"],
  forum_thread: ["forum", "threadId"],
  forum_reply: ["forum", "threadId"],
  collaborative_space: ["space", "spaceId"],
  announcement: ["announcement", "announcementId"],
  meeting: ["meeting", "meetingId"],
  company_alert: ["company_alert", "companyAlertId"],
  meeting_minutes: ["minutes", "eventId"],
  certificate: ["certificate_event", "eventId"],
  normativa: ["normativa", "publicationId"],
} as const;

export function notificationTarget(type: string | null | undefined, data?: Record<string, unknown>) {
  const source = sources[type as keyof typeof sources];
  if (!source) return null;
  const id = data?.[source[1]];
  return typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 2147483647
    ? { kind: source[0], id }
    : null;
}

export function validNotificationTarget(value: unknown): { kind: string; id: number } | null {
  if (!value || typeof value !== "object") return null;
  const { kind, id } = value as Record<string, unknown>;
  return typeof kind === "string" && Object.values(sources).some(([allowed]) => allowed === kind)
    && typeof id === "number" && Number.isInteger(id) && id > 0 && id <= 2147483647
    ? { kind, id } : null;
}
