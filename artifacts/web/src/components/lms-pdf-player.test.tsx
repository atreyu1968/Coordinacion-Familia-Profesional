import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LmsPdfPlayer } from "./lms-pdf-player";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(), getPage: vi.fn(), destroy: vi.fn(), renderPage: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: mocks.getDocument,
}));

let visibility: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
beforeEach(() => {
  visibility = [];
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      visibility.push(callback);
    }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  mocks.renderPage.mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  mocks.getPage.mockImplementation(async () => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 840 * scale }),
    render: mocks.renderPage,
  }));
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({ numPages: 3, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("muestra todas las páginas en una sola región de scroll sin botones de paginación", async () => {
  render(<LmsPdfPlayer title="Material" loadPdf={async () => new ArrayBuffer(20)} />);
  await screen.findByText("3 páginas · Desplazamiento vertical");
  const region = screen.getByRole("region", { name: "Páginas del PDF" });
  expect(region.className).toContain("overflow-auto");
  expect(region.tabIndex).toBe(0);
  for (let page = 1; page <= 3; page++) {
    expect(region.contains(screen.getByLabelText(`Página ${page} de 3`))).toBe(true);
  }
  expect(screen.queryByRole("button", { name: "Siguiente" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Anterior" })).toBeNull();
  await act(async () => visibility.forEach((callback) => callback([{ isIntersecting: true }])));
  await waitFor(() => expect(mocks.renderPage).toHaveBeenCalledTimes(3));
  expect(screen.getAllByRole("img")).toHaveLength(3);
  await act(async () => visibility.forEach((callback) => callback([{ isIntersecting: false }])));
  expect(screen.queryAllByRole("img")).toHaveLength(0);
  expect(screen.getByLabelText("Página 3 de 3")).toBeTruthy();
});

it("permite reintentar cuando falla la carga del documento", async () => {
  const loadPdf = vi.fn().mockRejectedValueOnce(new Error("No se pudo abrir el PDF."))
    .mockResolvedValue(new ArrayBuffer(20));
  render(<LmsPdfPlayer title="Material" loadPdf={loadPdf} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  await screen.findByText("3 páginas · Desplazamiento vertical");
  expect(loadPdf).toHaveBeenCalledTimes(2);
});
