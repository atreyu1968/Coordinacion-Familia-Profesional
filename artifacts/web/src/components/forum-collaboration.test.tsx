import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ForumCollaboration } from "@workspace/api-client-react";
import { CollaborationConfigDialog } from "./forum-collaboration";

const { mutateAsync } = vi.hoisted(() => ({ mutateAsync: vi.fn().mockResolvedValue({}) }));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useConfigureForumCollaboration: () => ({ mutateAsync, isPending: false }),
  useInitializeForumCollaboration: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

beforeEach(() => vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const imported: ForumCollaboration = {
  moduleId: 7, moduleCode: "001", moduleName: "Módulo de ensayo", cycleName: "Ciclo",
  academicYear: "2026-2027", enabled: false, canConfigure: true, canReviewCurriculum: true, verificationCurrent: true,
  fingerprint: "fp", diagnostics: [], threads: [],
  sections: Array.from({ length: 16 }, (_, i) => ({
    key: `PD-${String(i + 1).padStart(2, "0")}`, title: `Apartado ${i}`, prompt: "Plantilla", enabled: true, order: i + 1,
  })),
  configuration: { revision: 1, enabled: false, officialCode: "001", sourceTitle: "Fuente revisada",
    sourceUrl: "https://www.boe.es/test", curriculumVersion: "1", territory: "Canarias",
    verifiedAt: "2026-10-31T00:00:00Z" },
  importReport: { reasons: [{ code: "previous_review", message: "Se conserva la revisión importada." }] },
};

describe("Imported source human confirmation", () => {
  it("requires an explicit checkbox even when the imported fingerprint is current", async () => {
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><CollaborationConfigDialog collab={imported} /></QueryClientProvider>);
    expect(screen.getByText("Se conserva la revisión importada.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-collab-configure"));
    const checkbox = screen.getByTestId("checkbox-collab-confirm");
    expect(checkbox.getAttribute("data-state")).toBe("unchecked");
    fireEvent.click(screen.getByTestId("switch-collab-enabled"));
    fireEvent.click(screen.getByTestId("button-collab-save"));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-collab-error").textContent).toContain("Debes confirmar");
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByTestId("button-collab-save"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce());
    expect(mutateAsync.mock.calls[0][0].data).toMatchObject({ enabled: true, confirmReviewed: true });
    await waitFor(() => expect(screen.queryByTestId("checkbox-collab-confirm")).toBeNull());
    fireEvent.click(screen.getByTestId("button-collab-configure"));
    expect(screen.getByTestId("checkbox-collab-confirm").getAttribute("data-state")).toBe("unchecked");
  });
});
