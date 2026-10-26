import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), read: vi.fn(), remove: vi.fn(),
  items: [] as Array<{ id: number; type: string; title: string; body: string; readAt: string | null }>,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.navigate],
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@workspace/api-client-react", () => ({
  getListNotificationsQueryKey: () => ["/notifications"],
  useListNotifications: () => ({ data: mocks.items }),
  useMarkNotificationRead: () => ({ mutate: mocks.read }),
  useDeleteNotification: () => ({ mutate: mocks.remove }),
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
import { AppNotifications } from "./space-notifications";

afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("navigation from notification cards", () => {
  it.each([
    ["announcement", "/anuncios"], ["event", "/eventos"], ["calendar", "/eventos"],
    ["lms_course", "/autodirigido"], ["certificate", "/mis-certificados"],
    ["meeting_minutes", "/actas"], ["message", "/chat"], ["chat_group", "/chat"],
    ["survey", "/encuestas"], ["document_form", "/formularios"],
    ["forum_reply", "/foros"], ["forum_thread", "/foros"],
    ["collaborative_space", "/espacio"], ["meeting", "/videoconferencias"],
    ["company_alert", "/fct"], ["year_confirmation", "/academica"],
  ])("opens the section when the %s card title is clicked", (type, route) => {
    mocks.items = [{ id: 7, type, title: "Aviso de prueba", body: "Contenido", readAt: null }];
    render(<AppNotifications userId={1} role="department_head" />);
    fireEvent.click(screen.getByText("Aviso de prueba"));
    expect(mocks.navigate).toHaveBeenCalledWith(route);
    expect(mocks.read).toHaveBeenCalledWith({ id: 7 });
  });
  it("supports keyboard activation and does not navigate on delete", () => {
    mocks.items = [{ id: 7, type: "event", title: "Aviso leído", body: "Contenido", readAt: "2026-10-26" }];
    render(<AppNotifications userId={1} role="teacher" />);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar aviso leído: Aviso leído" }));
    expect(mocks.remove).toHaveBeenCalledWith({ id: 7 });
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("link", { name: "Abrir aviso: Aviso leído" }), { key: "Enter" });
    expect(mocks.navigate).toHaveBeenCalledWith("/eventos");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
