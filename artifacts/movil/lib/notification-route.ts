import type { Href } from "expo-router";
import { notificationTargetPath } from "@workspace/api-client-react";

/** Pure routing map, with no native notification imports in browser callers. */
export function notificationRoute(data: unknown): Href | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const exact = notificationTargetPath(payload.target, "mobile");
  if (exact) return exact as Href;
  const id = (value: unknown) => {
    const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
    return /^[1-9]\d*$/.test(text) && Number(text) <= 2147483647 ? text : null;
  };
  switch (payload.type) {
    case "forum_digest": {
      const moduleId = id(payload.moduleId);
      return moduleId ? `/foros/modulo/${moduleId}` as Href : "/foros";
    }
    case "chat_group":
    case "message": {
      const groupId = id(payload.groupId);
      return groupId ? { pathname: "/chat/[id]", params: { id: groupId } } : "/(tabs)/chat";
    }
    case "survey": {
      const surveyId = id(payload.surveyId);
      return surveyId ? { pathname: "/survey/[id]", params: { id: surveyId } } : "/surveys";
    }
    case "document_form": {
      const formId = id(payload.documentFormId);
      return formId ? { pathname: "/form/[id]", params: { id: formId } } : "/forms";
    }
    case "forum_thread":
    case "forum_reply": {
      const threadId = id(payload.threadId);
      return threadId ? { pathname: "/foros/tema/[id]", params: { id: threadId } } : "/foros";
    }
    case "collaborative_space": return "/espacios-colaborativos";
    case "lms_course": {
      const courseId = id(payload.courseId);
      return courseId ? { pathname: "/lms/[id]", params: { id: courseId } } : "/lms";
    }
    case "announcement": return "/(tabs)";
    case "certificate": return "/mis-certificados";
    case "meeting_minutes": return "/actas";
    case "meeting": return "/videoconferencias";
    case "company_alert": return "/alerts";
    case "year_confirmation": return "/confirmar-curso";
    case "event":
    case "calendar": return "/eventos";
    default: return "/(tabs)/notifications";
  }
}
