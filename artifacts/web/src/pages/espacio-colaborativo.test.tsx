import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EspacioColaborativoPage from "./espacio-colaborativo";

const mocks = vi.hoisted(() => ({
  modules: [
    { id: 5, name: "Tareas administrativas", code: "MF005", cycleName: "Ciclo Zeta" },
    { id: 4, name: "Tutorización", code: "MF004", cycleName: "FPA · Itinerario B" },
    { id: 3, name: "Atención al cliente", code: "MF003", cycleName: "Ciclo Alfa" },
    { id: 2, name: "Zonas de trabajo", code: "MF002", cycleName: "FPA · Itinerario A" },
    { id: 1, name: "Alfabetización digital", code: "MF001", cycleName: "FPA · Itinerario A" },
    { id: 6, name: "Módulo sin ciclo", code: "MF006", cycleName: null },
  ],
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, role: "teacher" } }),
}));
vi.mock("@/lib/use-module-param", () => ({ useModuleParam: () => null }));
vi.mock("@/lib/notification-selection", () => ({ useNoticeId: () => null }));
vi.mock("@/components/collab/independent-spaces-section", () => ({
  IndependentSpacesSection: () => null,
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListModules: () => ({ data: mocks.modules, isLoading: false }),
  useGetCollabStatus: () => ({ data: { configured: false }, isLoading: false }),
  useOpenModuleSpace: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOpenCollaborativeSpace: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

describe("espacios colaborativos por ciclo", () => {
  it("agrupa y ordena ciclos y módulos, y destaca cada ciclo FP Adaptada", () => {
    render(<EspacioColaborativoPage />);

    const regions = screen.getAllByRole("region");
    expect(regions.map((region) => within(region).getByRole("heading", { level: 3 }).textContent))
      .toEqual([
        "Ciclo Alfa",
        "Ciclo Zeta",
        "FPA · Itinerario A",
        "FPA · Itinerario B",
        "Sin ciclo",
      ]);

    const itineraryA = regions[2];
    expect(within(itineraryA).getByText("FP Adaptada")).toBeTruthy();
    expect(within(itineraryA).getAllByText(/MF00[12] · /).map((node) => node.textContent))
      .toEqual(["MF001 · Alfabetización digital", "MF002 · Zonas de trabajo"]);
    expect(within(regions[3]).getByText("FP Adaptada")).toBeTruthy();
  });

  it("encuentra módulos por nombre, código y nombre del ciclo", () => {
    render(<EspacioColaborativoPage />);
    const search = screen.getByRole("textbox", { name: "Buscar módulo o ciclo" });

    fireEvent.change(search, { target: { value: "atención al cliente" } });
    expect(screen.getByText("MF003 · Atención al cliente")).toBeTruthy();
    expect(screen.queryByText("MF005 · Tareas administrativas")).toBeNull();

    fireEvent.change(search, { target: { value: "mf004" } });
    expect(screen.getByText("MF004 · Tutorización")).toBeTruthy();
    expect(screen.queryByText("MF003 · Atención al cliente")).toBeNull();

    fireEvent.change(search, { target: { value: "itinerario a" } });
    expect(screen.getByText("MF001 · Alfabetización digital")).toBeTruthy();
    expect(screen.getByText("MF002 · Zonas de trabajo")).toBeTruthy();
    expect(screen.queryByText("MF004 · Tutorización")).toBeNull();
  });
});
