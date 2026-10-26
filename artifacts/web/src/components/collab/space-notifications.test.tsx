import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), read: vi.fn(), remove: vi.fn(),
  items: [] as Array<{ id: number; type: string; title: string; body: string; readAt: string | null; target?: unknown }>,
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", mocks.navigate],
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
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
    ["event", "/eventos?evento=42"], ["course", "/autodirigido?curso=42"],
    ["chat", "/chat?grupo=42"], ["certificate_event", "/mis-certificados?aviso=42"],
    ["forum", "/foros?tema=42"], ["survey", "/encuestas?aviso=42"],
  ])("opens a persisted %s target from the card and its link", (kind, route) => {
    mocks.items = [{ id: 7, type: "event", title: "Destino guardado", body: "", readAt: null, target: { kind, id: 42 } }];
    render(<AppNotifications userId={1} role="teacher" />);
    expect(screen.getByRole("link", { name: "Abrir elemento del aviso" }).getAttribute("href")).toBe(route);
    fireEvent.keyDown(screen.getByRole("link", { name: "Abrir aviso: Destino guardado" }), { key: "Enter" });
    expect(mocks.navigate).toHaveBeenCalledWith(route);
    expect(mocks.read).toHaveBeenCalledWith({ id: 7 });
  });
  it("ignores malformed and external destinations", () => {
    mocks.items = [{ id: 7, type: "event", title: "Aviso", body: "", readAt: null, target: { kind: "https://example.org", id: 42 } }];
    render(<AppNotifications userId={1} role="teacher" />);
    fireEvent.click(screen.getByText("Aviso"));
    expect(mocks.navigate).toHaveBeenCalledWith("/eventos");
  });
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
