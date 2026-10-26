import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, integrationSettingsTable: {}, pushTokensTable: {} }));
vi.mock("../src/lib/settings", () => ({ getSettings: vi.fn() }));
import { withPushPath } from "../src/lib/push";

describe("PWA notification destinations", () => {
  it.each([
    ["announcement", "/"], ["event", "/eventos"], ["calendar", "/eventos"],
    ["lms_course", "/lms"], ["collaborative_space", "/espacios-colaborativos"],
    ["certificate", "/mis-certificados"], ["meeting_minutes", "/actas"],
    ["message", "/chat"], ["chat_group", "/chat"], ["survey", "/surveys"],
    ["document_form", "/forms"], ["forum_reply", "/foros"],
  ])("maps %s to an available PWA section", (type, path) => {
    expect(withPushPath({ title: "Aviso", data: { type } }).data?.path).toBe(path);
  });
  it("preserves the course target without accepting malformed ids", () => {
    expect(withPushPath({ title: "Curso", data: { type: "lms_course", courseId: 12 } }).data?.path).toBe("/lms/12");
    expect(withPushPath({ title: "Curso", data: { type: "lms_course", courseId: "../login" } }).data?.path).toBe("/lms");
  });
});
