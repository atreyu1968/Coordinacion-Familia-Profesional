import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const route = vi.hoisted(() => ({ search: "aviso=2" }));
vi.mock("wouter", () => ({
  useSearch: () => route.search,
  useLocation: () => ["/anuncios", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
import { useNoticeItems, NotificationSelection } from "./notification-selection";
const authorized = [{ id: 1, name: "Otro anuncio" }, { id: 2, name: "Elemento concreto" }];
function Subject() {
  const items = useNoticeItems(authorized);
  return <><NotificationSelection />{items.map((item) => <p key={item.id}>{item.name}</p>)}</>;
}
afterEach(cleanup);
describe("notice selection within authorized lists", () => {
  it("opens just the indicated element and responds to the next notification", () => {
    route.search = "aviso=2";
    const view = render(<Subject />);
    expect(screen.getByText("Elemento concreto")).toBeTruthy();
    expect(screen.queryByText("Otro anuncio")).toBeNull();
    route.search = "aviso=1";
    view.rerender(<Subject />);
    expect(screen.getByText("Otro anuncio")).toBeTruthy();
    expect(screen.queryByText("Elemento concreto")).toBeNull();
  });
  it("does not broaden access when the requested element is absent", () => {
    route.search = "aviso=99";
    render(<Subject />);
    expect(screen.queryByText("Elemento concreto")).toBeNull();
    expect(screen.queryByText("Otro anuncio")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("ya no está disponible o no tienes acceso");
  });
  it.each(["", "aviso=0", "aviso=../login", "aviso=2147483648"])("keeps historical/malformed links in the section: %s", (search) => {
    route.search = search;
    render(<Subject />);
    expect(screen.getByText("Otro anuncio")).toBeTruthy();
    expect(screen.getByText("Elemento concreto")).toBeTruthy();
  });
});
