import { describe, expect, it } from "vitest";
import { buildChatPushPayload } from "../src/lib/chatPushPayload";
import { parseBeforeId } from "../src/lib/messageCursor";
import { isCurrentTokenVersion } from "../src/lib/sessionVersion";

describe("message pagination and session-version helpers", () => {
  it("accepts an omitted or positive safe beforeId", () => {
    expect(parseBeforeId(undefined)).toEqual({ ok: true });
    expect(parseBeforeId("42")).toEqual({ ok: true, beforeId: 42 });
  });

  it("rejects malformed or unsafe beforeId values", () => {
    for (const value of ["0", "-1", "1.5", "abc", "9007199254740992", ["42"]]) {
      expect(parseBeforeId(value)).toEqual({ ok: false });
    }
  });

  it("accepts only sockets whose token version is current", () => {
    expect(isCurrentTokenVersion(3, 3)).toBe(true);
    expect(isCurrentTokenVersion(2, 3)).toBe(false);
  });

  it("builds a useful chat push alert without message content", () => {
    const payload = buildChatPushPayload("María", 17);
    expect(payload).toEqual({
      title: "Nuevo mensaje",
      body: "María te ha enviado un mensaje.",
      data: { type: "message", groupId: 17 },
    });
    expect(payload.body).not.toContain("private message");
    expect(payload.data).not.toHaveProperty("content");
  });
});