import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiLinkHealth, WikiLinkReviews } from "./wiki-link-health";
import type { WikiLinkReview } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({ query: vi.fn(), mutate: vi.fn(), invalidate: vi.fn(), options: null as any }));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListWikiLinkReviews: mocks.query,
  useResolveWikiLinkReview: (options: unknown) => {
    mocks.options = options;
    return { mutate: mocks.mutate, isPending: false, isError: false };
  },
}));
const link: WikiLinkReview = {
  id: 1, title: "Norma editada", url: "https://www.boe.es/original",
  createdAt: "2026-10-01T00:00:00Z", checkStatus: "redirected",
  checkedAt: "2026-10-27T00:00:00Z", nextCheckAt: "2026-11-03T00:00:00Z",
  httpStatus: 200, redirectUrl: "https://www.boe.es/nuevo", pageId: 5, pageTitle: "Marco estatal",
  incidentVersion: 3, resolvedAt: null, reviewHistory: [],
};
afterEach(cleanup);

it("shows separate redirect destination and check dates without replacing the original", () => {
  render(<WikiLinkHealth link={link} />);
  expect(screen.getByText(/Redirección: revisar destino/)).toBeTruthy();
  expect(screen.getByText(/Última comprobación:/)).toBeTruthy();
  expect(screen.getByText(/Próxima comprobación:/)).toBeTruthy();
  expect(screen.getByText("Destino observado: https://www.boe.es/nuevo")).toBeTruthy();
  expect(link.url).toBe("https://www.boe.es/original");
});
it("offers a page-level review action and periodically refreshes the diagnostics", () => {
  mocks.query.mockReturnValue({ data: [link], isPending: false, isError: false });
  const onSelect = vi.fn();
  render(<WikiLinkReviews onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /Marco estatal · Norma editada/ }));
  expect(onSelect).toHaveBeenCalledWith(5);
  expect(screen.getByText(link.url)).toBeTruthy();
  expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({
    query: expect.objectContaining({ refetchInterval: 60_000 }),
  }));
});
it("distinguishes a failed review request from an empty incident list", () => {
  const refetch = vi.fn();
  mocks.query.mockReturnValue({ isError: true, isPending: false, refetch });
  render(<WikiLinkReviews onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(refetch).toHaveBeenCalledOnce();
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText(/No hay incidencias/)).toBeNull();
});

it("sends the note and incident version, clears the form and refreshes wiki views after saving", () => {
  mocks.query.mockReturnValue({ data: [link], isPending: false, isError: false });
  render(<WikiLinkReviews onSelect={vi.fn()} />);
  const input = screen.getByRole("textbox");
  expect(screen.getByRole("button", { name: "Registrar revisión" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(input, { target: { value: "  Mantener la URL oficial.  " } });
  fireEvent.click(screen.getByRole("button", { name: "Registrar revisión" }));
  expect(mocks.mutate).toHaveBeenCalledWith({ externalLinkId: 1, data: { note: "Mantener la URL oficial.", incidentVersion: 3 } });
  // Run the server-success callback to exercise cache invalidation.
  mocks.options.mutation.onSuccess();
  expect(mocks.invalidate).toHaveBeenCalled();
});

it("keeps reviewed notes available and a reopened incident shows the old history", () => {
  const reviewed = { ...link, resolvedAt: "2026-10-28T12:00:00Z", reviewHistory: [{
    note: "Destino comprobado; mantener fuente", reviewedAt: "2026-10-28T12:00:00Z",
    reviewedBy: 2, incidentVersion: 3, checkStatus: "redirected", httpStatus: 200, redirectUrl: link.redirectUrl,
  }] };
  mocks.query.mockReturnValue({ data: [reviewed], isPending: false, isError: false });
  const view = render(<WikiLinkReviews onSelect={vi.fn()} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ver revisados e historial" }));
  expect(screen.getByText("Destino comprobado; mantener fuente")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  view.unmount();
  mocks.query.mockReturnValue({ data: [{ ...reviewed, resolvedAt: null, incidentVersion: 4, checkStatus: "blocked" }], isPending: false });
  render(<WikiLinkReviews onSelect={vi.fn()} />);
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.getByText("Destino comprobado; mantener fuente")).toBeTruthy();
});
