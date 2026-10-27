import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NormativaMonitor } from "./normativa-monitor";

const mock = vi.hoisted(() => ({
  list: vi.fn(), check: vi.fn(async () => undefined), review: vi.fn(async () => undefined), invalidate: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mock.invalidate }) }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getListNormativaQueryKey: () => ["/api/wiki/normativa"],
  useListNormativa: (params: unknown) => {
    mock.list(params);
    return { data: { enabled: true, running: false, total: 1, sources: [{
      source: "BOE", startedFrom: "2026-10-21", coveredThrough: "2026-10-22", attemptedAt: null, succeededAt: null, error: "Fuente temporalmente no disponible",
    }], items: [{
      id: 1, source: "BOE", officialId: "BOE-A-2026-1", title: "Modificación de FP",
      url: "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-1", publishedAt: "2026-10-27",
      detectedAt: "2026-10-27T12:00:00Z", checkedAt: "2026-10-27T12:00:00Z", relevance: "uncertain",
      reason: "Aplicabilidad no confirmada", status: "pending", reviewedAt: null,
    }] }, isLoading: false, isError: false };
  },
  useCheckNormativa: () => ({ mutateAsync: mock.check, isPending: false }),
  useReviewNormativa: () => ({ mutateAsync: mock.review, isPending: false }),
}));
afterEach(cleanup);

it("expone cobertura, errores y fuente oficial sin afirmar vigencia", () => {
  render(<NormativaMonitor />);
  expect(screen.getByRole("alert").textContent).toContain("Fuente temporalmente no disponible");
  expect(screen.getByText(/No acredita vigencia/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Consultar publicación oficial" }).getAttribute("href")).toContain("www.boe.es");
});
it("exige una nota, envía el estado esperado e invalida la bandeja", async () => {
  render(<NormativaMonitor />);
  const save = screen.getByRole("button", { name: "Marcar revisada" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Nota de revisión: alcance, artículos y pasos necesarios"), { target: { value: "Solo se aplica al régimen indicado" } });
  fireEvent.click(save);
  await waitFor(() => expect(mock.review).toHaveBeenCalledWith({ id: 1, data: { status: "reviewed", expectedStatus: "pending", reviewNote: "Solo se aplica al régimen indicado" } }));
  expect(mock.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/wiki/normativa"] });
});
it("permite comprobar y filtrar las novedades descartadas", async () => {
  render(<NormativaMonitor />);
  fireEvent.click(screen.getByRole("button", { name: "Comprobar ahora" }));
  await waitFor(() => expect(mock.check).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Descartadas" }));
  expect(mock.list).toHaveBeenLastCalledWith({ status: "dismissed", offset: 0 });
});
