import type { Href } from "expo-router";

/** Pure routing map, with no native notification imports in browser callers. */
export function notificationRoute(data: unknown): Href | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Record<string, unknown>;
  const id = (value: unknown) => {
    const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
    return /^[1-9]\d*$/.test(text) ? text : null;
  };
  switch (payload.type) {
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
    case "lms_course": return "/lms";
    case "certificate": return "/mis-certificados";
    case "meeting_minutes": return "/actas";
    case "meeting": return "/videoconferencias";
    case "company_alert": return "/alerts";
    case "year_confirmation": return "/confirmar-curso";
    case "event":
    case "calendar": return "/(tabs)";
    default: return "/(tabs)/notifications";
  }
}
