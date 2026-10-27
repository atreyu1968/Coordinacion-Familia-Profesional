import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DocumentacionPage from "./documentacion";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  userRole: "teacher",
  canCreate: false,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, role: mocks.userRole } }) }));
vi.mock("@/lib/use-module-param", () => ({ useModuleParam: () => null }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/components/wiki-link-health", () => ({
  WikiLinkHealth: () => null,
  WikiLinkReviews: () => null,
}));
vi.mock("@workspace/api-client-react", async (original) => {
  const mutation = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    ...await original<typeof import("@workspace/api-client-react")>(),
    useListModules: () => ({ data: [], isLoading: false }),
    useListWikiPages: (params: unknown) => {
      mocks.list(params);
      return { data: { items: [], canCreate: mocks.canCreate }, isLoading: false };
    },
    useGetWikiPage: () => ({ data: undefined, isLoading: false }),
    useRequestWikiUploadUrl: mutation, useAddWikiAttachment: mutation,
    useDeleteWikiAttachment: mutation, useDeleteWikiExternalLink: mutation,
    useAddWikiExternalLink: mutation, useDeleteWikiPage: mutation,
    useCreateWikiPage: mutation, useUpdateWikiPage: mutation,
  };
});
afterEach(() => {
  cleanup();
  mocks.userRole = "teacher";
  mocks.canCreate = false;
});

it("abre Normativa con etiqueta y ámbito general y permite volver a toda la documentación", () => {
  render(<DocumentacionPage />);
  fireEvent.click(screen.getByRole("button", { name: "Normativa" }));
  expect(mocks.list).toHaveBeenLastCalledWith({ globalOnly: true, tag: "normativa" });
  expect(screen.getByRole("button", { name: "Normativa" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Toda la documentación" }));
  expect(mocks.list).toHaveBeenLastCalledWith({});
});

it("no muestra el seguimiento normativo de confirmación a coordinadores", () => {
  mocks.userRole = "coordinator";
  render(<DocumentacionPage />);
  fireEvent.click(screen.getByRole("button", { name: "Normativa" }));
  expect(screen.queryByText("Seguimiento normativo · BOE y BOC")).toBeNull();
});

it("permite al superadministrador crear documentación general desde Todas las secciones", () => {
  mocks.userRole = "superadmin";
  mocks.canCreate = true;
  render(<DocumentacionPage />);

  fireEvent.click(screen.getByTestId("button-create-wiki-page"));

  expect(screen.getByText("Se guardará en «Documentación general». El contenido es privado y solo se muestra a usuarios autenticados.")).toBeTruthy();
});
