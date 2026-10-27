import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiLinkHealth, WikiLinkReviews } from "./wiki-link-health";
import type { WikiLinkReview } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListWikiLinkReviews: mocks.query,
}));
const link: WikiLinkReview = {
  id: 1, title: "Norma editada", url: "https://www.boe.es/original",
  createdAt: "2026-10-01T00:00:00Z", checkStatus: "redirected",
  checkedAt: "2026-10-27T00:00:00Z", nextCheckAt: "2026-11-03T00:00:00Z",
  httpStatus: 200, redirectUrl: "https://www.boe.es/nuevo", pageId: 5, pageTitle: "Marco estatal",
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
