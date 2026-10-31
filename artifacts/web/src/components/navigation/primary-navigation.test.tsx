import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PrimaryNavigation } from "./primary-navigation";
import { CORPORATE_EMAIL_URL, DASHBOARD_ITEM, getNavigationGroups, navigationItemIsActive } from "./navigation-items";

vi.mock("wouter", () => ({
  Link: ({ href, children, onClick, ...props }: ComponentProps<"a">) =>
    <a {...props} href={href} onClick={event => { event.preventDefault(); onClick?.(event); }}>{children}</a>,
}));
afterEach(cleanup);

describe("grouped navigation and role visibility", () => {
  const common = ["/", "/usuarios", "/academica", "/eventos", CORPORATE_EMAIL_URL, "/videoconferencias",
    "/anuncios", "/chat", "/espacio", "/documentacion", "/foros", "/encuestas", "/formularios",
    "/recursos", "/sugerencias", "/app-movil", "/mis-certificados", "/autodirigido"];
  it.each(["teacher", "department_head", "coordinator", "superadmin"])("retains every existing visible route for %s without duplicates", role => {
    const expected = [...common];
    if (role !== "superadmin") expected.push("/centros");
    if (role !== "teacher") expected.push("/invitaciones");
    if (role === "department_head") expected.push("/actas");
    if (role === "coordinator" || role === "superadmin") expected.push("/asuntos-correo", "/tareas-pendientes", "/memorias");
    if (role === "superadmin") expected.push("/asistente-ia", "/panel-control");
    const groups = getNavigationGroups(role);
    const actual = [DASHBOARD_ITEM.path, ...groups.flatMap(group => group.items.map(item => item.path))];
    expect(actual.sort()).toEqual(expected.sort());
    expect(new Set(actual).size).toBe(actual.length);
    expect(groups.every(group => group.items.length > 0)).toBe(true);
  });
  it("uses different icons for every group and destination", () => {
    const groups = getNavigationGroups("coordinator");
    const icons = [DASHBOARD_ITEM.icon, ...groups.flatMap(g => [g.icon, ...g.items.map(i => i.icon)])];
    expect(new Set(icons).size).toBe(icons.length);
  });
  it("matches nested pages, not unrelated prefixes or external URLs", () => {
    expect(navigationItemIsActive("/foros/12?tab=debates", "/foros")).toBe(true);
    expect(navigationItemIsActive("/foros-archivo", "/foros")).toBe(false);
    expect(navigationItemIsActive("/centros", "/")).toBe(false);
    expect(navigationItemIsActive("/?view=summary", "/")).toBe(true);
    expect(navigationItemIsActive(CORPORATE_EMAIL_URL, CORPORATE_EMAIL_URL)).toBe(false);
  });
  it("starts at the dashboard with only the direct link and collapsed category buttons", () => {
    render(<PrimaryNavigation role="superadmin" location="/" />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Panel principal" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByRole("button")).toHaveLength(6);
    expect(screen.getAllByRole("button").every(b => b.getAttribute("aria-expanded") === "false")).toBe(true);
  });
  it("opens the active category and allows only one open category at a time", () => {
    render(<PrimaryNavigation role="teacher" location="/foros/12" />);
    const communication = screen.getByRole("button", { name: "Comunicación" });
    expect(communication.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Foros" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Documentación y cursos" }));
    expect(communication.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: "Foros" })).toBeNull();
    expect(screen.getByRole("link", { name: "Documentación" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Documentación y cursos" }));
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
  it("automatically reveals the new active category after navigation and role changes", () => {
    const view = render(<PrimaryNavigation role="superadmin" location="/panel-control" />);
    expect(screen.getByRole("link", { name: "Configuración" })).toBeTruthy();
    view.rerender(<PrimaryNavigation role="teacher" location="/recursos" />);
    expect(screen.queryByRole("button", { name: "Administración" })).toBeNull();
    expect(screen.getByRole("button", { name: "Documentación y cursos" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Recursos" }).getAttribute("aria-current")).toBe("page");
  });
  it("keeps compact rail controls accessible and reveals the selected category when expanded", () => {
    const view = render(<PrimaryNavigation role="teacher" location="/foros" expanded={false} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Comunicación" }).title).toBe("Comunicación: Foros");
    view.rerender(<PrimaryNavigation role="teacher" location="/foros" expanded />);
    expect(screen.getByRole("link", { name: "Foros" })).toBeTruthy();
  });
  it("retains mobile navigation callbacks and safe external new-tab links", () => {
    const onNavigate = vi.fn();
    render(<PrimaryNavigation role="teacher" location="/chat" mobile onNavigate={onNavigate} />);
    const external = screen.getByRole("link", { name: /Correo corporativo/ });
    expect(external.getAttribute("href")).toBe(CORPORATE_EMAIL_URL);
    expect(external.getAttribute("target")).toBe("_blank");
    expect(external.getAttribute("rel")).toContain("noopener");
    fireEvent.click(screen.getByRole("link", { name: "Mensajes" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
  it("uses separate accessible panel IDs for desktop and mobile menus", () => {
    const { container } = render(<>
      <PrimaryNavigation role="teacher" location="/chat" />
      <PrimaryNavigation role="teacher" location="/chat" mobile />
    </>);
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const button of container.querySelectorAll("[aria-controls]")) {
      expect(container.querySelector(`[id="${button.getAttribute("aria-controls")}"]`)).toBeTruthy();
    }
  });
});
