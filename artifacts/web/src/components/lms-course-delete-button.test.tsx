import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LmsCourseDeleteButton } from "./lms-course-delete-button";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  pending: false,
}));

vi.mock("@workspace/api-client-react", () => ({
  useDeleteLmsCourse: () => ({ mutateAsync: mocks.remove, isPending: mocks.pending }),
  getListLmsCoursesQueryKey: () => ["courses"],
  getGetLmsCourseQueryKey: (id: number) => ["course", id],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

const course = { id: 42, title: "Contabilidad" };

describe("eliminación confirmada de cursos", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.pending = false;
    mocks.remove.mockResolvedValue(undefined);
    mocks.invalidate.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  function openConfirmation() {
    fireEvent.click(screen.getByRole("button", { name: "Eliminar curso Contabilidad" }));
  }

  it("no solicita el borrado al abrir ni al cancelar", () => {
    render(<LmsCourseDeleteButton course={course} />);
    openConfirmation();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText(/Su historial y sus archivos/)).toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("envía el ID correcto, cierra y actualiza el catálogo y el detalle", async () => {
    const onDeleted = vi.fn();
    render(<LmsCourseDeleteButton course={course} onDeleted={onDeleted} />);
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ courseId: 42 });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["courses"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["course", 42], refetchType: "none",
    });
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Curso eliminado" }));
  });

  it("mantiene la confirmación y permite reintentar si el servidor rechaza", async () => {
    const onDeleted = vi.fn();
    mocks.remove.mockRejectedValueOnce(new Error("Permiso denegado"));
    render(<LmsCourseDeleteButton course={course} onDeleted={onDeleted} />);
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Permiso denegado"));
    expect(onDeleted).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar eliminación" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
  });

  it("bloquea confirmar y cancelar mientras está eliminando", () => {
    const view = render(<LmsCourseDeleteButton course={course} />);
    openConfirmation();
    mocks.pending = true;
    view.rerender(<LmsCourseDeleteButton course={course} />);
    expect((screen.getByRole("button", { name: "Eliminando..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
