import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("react-native", async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  StyleSheet: { create: (styles: Record<string, unknown>) => styles },
}));
vi.mock("../../../movil/components/AppHeader", () => ({
  AppHeader: () => <header>Cursos autodirigidos</header>,
}));
vi.mock("../../../movil/hooks/useColors", () => ({
  useColors: () => ({ background: "#fff", foreground: "#111", card: "#fff", border: "#ddd", mutedForeground: "#666" }),
}));
afterEach(cleanup);

// Runtime imports keep Expo's private @/ aliases out of web's TS project.
it.each([["catálogo", "../../../movil/app/lms.tsx"], ["enlace directo al curso", "../../../movil/app/lms/[id].tsx"]] as const)(
  "muestra solo el aviso web al acceder a %s desde móvil/PWA",
  async (_name, routePath) => {
    const { default: Route } = await vi.importActual<{ default: React.ComponentType }>(routePath);
    render(<Route />);
    expect(screen.getByText("Disponible en la aplicación web")).toBeTruthy();
    expect(screen.getByText(/Para realizar los cursos, accede a la aplicación web desde un ordenador/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Abrir curso|Siguiente|Completar|Comenzar/i })).toBeNull();
    expect(document.querySelector("iframe, video, input")).toBeNull();
  },
);
