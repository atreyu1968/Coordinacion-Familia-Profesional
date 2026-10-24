import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@workspace/api-client-react";
import { chatMemberAvatarColor, chatMemberNameColor } from "./chat-role-colors";
import { chatMemberColor } from "../../../movil/lib/chat-role-colors";
import { MessageBubble } from "../pages/chat";

afterEach(cleanup);
const colors = {
  chatCoordinator: "#7c3aed", chatDepartmentHead: "#15803d", chatMember: "#0050b3",
};

describe("chat role colors in both clients", () => {
  it.each([
    ["coordinator", "violet", colors.chatCoordinator],
    ["department_head", "emerald", colors.chatDepartmentHead],
    ["teacher", "blue", colors.chatMember],
    ["superadmin", "blue", colors.chatMember],
    ["prospector", "blue", colors.chatMember],
    [null, "blue", colors.chatMember],
    [undefined, "blue", colors.chatMember],
  ])("uses the requested color for role %s", (role, family, hex) => {
    expect(chatMemberNameColor(role)).toContain(`text-${family}-700`);
    expect(chatMemberNameColor(role)).toContain(`dark:text-${family}-300`);
    expect(chatMemberAvatarColor(role)).toContain(`bg-${family}-100`);
    expect(chatMemberColor(role, colors)).toBe(hex);
  });

  it.each([
    { role: "coordinator", family: "violet", mine: false },
    { role: "coordinator", family: "violet", mine: true },
    { role: "department_head", family: "emerald", mine: false },
    { role: "department_head", family: "emerald", mine: true },
    { role: "teacher", family: "blue", mine: false },
    { role: "teacher", family: "blue", mine: true },
  ] as const)("shows a colored sender name for $role, own message: $mine", ({ role, family, mine }) => {
    const noop = vi.fn();
    render(<MessageBubble
      message={{ id: 1, groupId: 1, senderId: 7, senderName: "Participante de prueba",
        content: "Mensaje de prueba", createdAt: "2026-10-24T12:00:00Z", kind: "text",
      } as Message}
      mine={mine} senderMeta={{ role, centerName: "Centro de prueba" }}
      onReact={noop} onReply={noop} onEdit={noop} onDelete={noop}
      onHideForMe={noop} onForward={noop}
    />);
    expect(screen.getByText("Participante de prueba").className).toContain(`text-${family}-700`);
    expect(screen.getByText(/Centro de prueba/)).toBeTruthy();
    if (mine) expect(screen.getByText("Participante de prueba").parentElement?.className)
      .toContain("bg-background");
  });

  it("uses the supplied dark mobile palette", () => {
    const dark = { chatCoordinator: "#c4b5fd", chatDepartmentHead: "#86efac", chatMember: "#93c5fd" };
    expect(chatMemberColor("coordinator", dark)).toBe(dark.chatCoordinator);
    expect(chatMemberColor("department_head", dark)).toBe(dark.chatDepartmentHead);
    expect(chatMemberColor("superadmin", dark)).toBe(dark.chatMember);
  });
});
