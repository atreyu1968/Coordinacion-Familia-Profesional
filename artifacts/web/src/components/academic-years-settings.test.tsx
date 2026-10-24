import React, { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcademicYearsSettings from "./academic-years-settings";
import { YearFilter } from "./year-selector";

const mocks = vi.hoisted(() => ({
  setActive: vi.fn(),
  create: vi.fn(),
  transition: vi.fn(),
  openConfirmation: vi.fn(),
  rename: vi.fn(),
  deleteYear: vi.fn(),
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
}));
const browserMethods = [
  "hasPointerCapture",
  "setPointerCapture",
  "releasePointerCapture",
  "scrollIntoView",
] as const;
let originalBrowserMethods: Partial<
  Record<(typeof browserMethods)[number], PropertyDescriptor | undefined>
> = {};

vi.mock("@workspace/api-client-react", () => ({
  useListAcademicYears: () => ({
    data: {
      activeYear: "2025/2026",
      years: [
        { id: 1, name: "2025/2026", groupCount: 4 },
        { id: 2, name: "2026/2027", groupCount: 2 },
      ],
    },
    isLoading: false,
  }),
  useCreateAcademicYear: () => ({ mutateAsync: mocks.create, isPending: false }),
  useSetActiveAcademicYear: () => ({
    mutateAsync: mocks.setActive,
    isPending: false,
  }),
  useTransitionAcademicYear: () => ({
    mutateAsync: mocks.transition,
    isPending: false,
  }),
  useOpenYearConfirmation: () => ({
    mutateAsync: mocks.openConfirmation,
    isPending: false,
  }),
  useRenameAcademicYear: () => ({ mutateAsync: mocks.rename, isPending: false }),
  useDeleteAcademicYear: () => ({
    mutateAsync: mocks.deleteYear,
    isPending: false,
  }),
  useListYearConfirmations: () => ({ data: [] }),
  useListChatAttachmentDeletions: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  useRetryChatAttachmentDeletion: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  getListChatAttachmentDeletionsQueryKey: () => ["chat-attachment-deletions"],
  getListAcademicYearsQueryKey: () => ["academic-years"],
  getListYearConfirmationsQueryKey: () => ["year-confirmations"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

function YearFilterHarness() {
  const [year, setYear] = useState("2025/2026");
  return <YearFilter value={year} onChange={setYear} />;
}

describe("academic-year chat cleanup confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    originalBrowserMethods = {};
    for (const method of browserMethods) {
      originalBrowserMethods[method] = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        method,
      );
    }
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: { configurable: true, value: () => false },
      setPointerCapture: { configurable: true, value: () => undefined },
      releasePointerCapture: { configurable: true, value: () => undefined },
      scrollIntoView: { configurable: true, value: () => undefined },
    });
    mocks.setActive.mockResolvedValue({
      activeYear: "2026/2027",
      chatCleanup: {
        conversationsDeleted: 3,
        messagesDeleted: 12,
        attachmentsDeleted: 2,
        attachmentDeletionFailures: 0,
      },
    });
    mocks.invalidateQueries.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    for (const method of browserMethods) {
      const original = originalBrowserMethods[method];
      if (original) {
        Object.defineProperty(HTMLElement.prototype, method, original);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[
          method
        ];
      }
    }
  });

  it("explains the permanent deletion and requires the superadmin's explicit confirmation", async () => {
    render(<AcademicYearsSettings />);

    const targetYear = screen.getByRole("row", { name: /2026\/2027/ });
    fireEvent.click(within(targetYear).getByRole("button", { name: /Activar/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("eliminará permanentemente");
    expect(dialog.textContent).toContain("todas las conversaciones");
    expect(dialog.textContent).toContain("los mensajes");
    expect(dialog.textContent).toContain("los grupos");
    expect(dialog.textContent).toContain("sus participantes");
    expect(dialog.textContent).toContain("los archivos adjuntos");
    expect(dialog.textContent).toContain(
      "Los filtros de curso no producen este borrado.",
    );
    expect(dialog.textContent).toContain(
      "Soy superadministrador y confirmo que se borren esos datos",
    );

    const confirmButton = within(dialog).getByRole("button", {
      name: "Borrar conversaciones y activar",
    });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.setActive).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.setActive).not.toHaveBeenCalled();
  });

  it("canceling preserves the active year and never requests chat cleanup", async () => {
    render(<AcademicYearsSettings />);

    const targetYear = screen.getByRole("row", { name: /2026\/2027/ });
    fireEvent.click(within(targetYear).getByRole("button", { name: /Activar/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("row", { name: /2025\/2026.*Activo/ })).toBeTruthy();
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("sends explicit consent on confirmation and displays the cleanup result", async () => {
    render(<AcademicYearsSettings />);

    const targetYear = screen.getByRole("row", { name: /2026\/2027/ });
    fireEvent.click(within(targetYear).getByRole("button", { name: /Activar/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Borrar conversaciones y activar",
        }),
      );
    });

    await waitFor(() => expect(mocks.setActive).toHaveBeenCalledTimes(1));
    expect(mocks.setActive).toHaveBeenCalledWith({
      data: {
        name: "2026/2027",
        confirmConversationDeletion: true,
      },
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Curso activado y conversaciones borradas",
      description:
        "Conversaciones: 3 · mensajes: 12 · adjuntos eliminados: 2",
      variant: "default",
    });
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["academic-years"],
    });
  });

  it("changing a course filter does not open the cleanup warning or activate a course", async () => {
    render(<YearFilterHarness />);

    const filter = screen.getByRole("combobox");
    fireEvent.pointerDown(filter, {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(
      await screen.findByRole("option", { name: /2026\/2027/ }),
    );

    expect(screen.getByRole("combobox").textContent).toContain("2026/2027");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.setActive).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
