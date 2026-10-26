import { test, expect } from "@playwright/test";
import { notificationRoute } from "./notification-router";

// Pure shared router contracts run alongside (but do not open) the browser.
// These are destination tests, not push/announcement delivery tests.
test("shared router keeps notice destinations internal and supports legacy payloads", () => {
  for (const [type, path] of [
    ["event", "/eventos"], ["calendar", "/eventos"],
    ["meeting_minutes", "/actas"], ["certificate", "/mis-certificados"],
  ]) {
    expect(notificationRoute({ type })).toBe(path);
    expect(notificationRoute({ type, path: "https://evil.invalid", url: "//evil.invalid" })).toBe(path);
  }
  for (const payload of [null, undefined, false, 42, "https://evil.invalid"]) {
    expect(notificationRoute(payload)).toBeNull();
  }
  expect(notificationRoute({ type: "unknown", path: "/perfil" })).toBe("/(tabs)/notifications");
});

test("shared router preserves valid detail identifiers and rejects URL/path injection", () => {
  for (const [type, key, pathname, fallback] of [
    ["message", "groupId", "/chat/[id]", "/(tabs)/chat"],
    ["chat_group", "groupId", "/chat/[id]", "/(tabs)/chat"],
    ["survey", "surveyId", "/survey/[id]", "/surveys"],
    ["document_form", "documentFormId", "/form/[id]", "/forms"],
    ["forum_thread", "threadId", "/foros/tema/[id]", "/foros"],
    ["forum_reply", "threadId", "/foros/tema/[id]", "/foros"],
    ["lms_course", "courseId", "/lms/[id]", "/lms"],
  ]) {
    for (const value of [17, "17"]) {
      expect(notificationRoute({ type, [key]: value })).toEqual({ pathname, params: { id: "17" } });
    }
    for (const value of [undefined, null, 0, -1, 1.5, "", "01", "1?next=/login", "../login", "//evil.invalid", {}, []]) {
      expect(notificationRoute({ type, [key]: value })).toBe(fallback);
    }
  }
});
