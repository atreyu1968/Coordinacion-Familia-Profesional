import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ForumCollaboration, ForumCurriculumHistoryEntry } from "@workspace/api-client-react";
import { ForumCurriculumReview } from "./forum-curriculum-review";

const mocks = vi.hoisted(() => ({
  previewRecovery: vi.fn(),
  recoverText: vi.fn(),
  history: [] as ForumCurriculumHistoryEntry[],
  historyDetail: "",
}));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  usePreviewForumCurriculum: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApplyForumCurriculum: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePreviewForumCurriculumRecovery: () => ({ mutateAsync: mocks.previewRecovery, isPending: false }),
  useRecoverForumCurriculumText: () => ({ mutateAsync: mocks.recoverText, isPending: false }),
  useGetForumCurriculumHistory: () => ({ data: { entries: mocks.history, nextBeforeRevision: null }, isLoading: false, isError: false }),
  useGetForumCurriculumHistoryDetail: () => ({
    data: { revision: 3, configuration: mocks.historyDetail }, isLoading: false, isError: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  mocks.previewRecovery.mockResolvedValue({
    token: "a".repeat(64), revision: 4, sourceRevision: 3, sourceSide: "before",
    fieldKey: JSON.stringify(["ra", "RA1"]), label: "RA RA1 · descripción",
    current: "Texto actual", restored: "Texto de la revisión anterior",
  });
  mocks.recoverText.mockResolvedValue({
    token: "a".repeat(64), revision: 5, sourceRevision: 3, sourceSide: "before",
    fieldKey: JSON.stringify(["ra", "RA1"]), label: "RA RA1 · descripción",
    current: "Texto actual", restored: "Texto de la revisión anterior",
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const collab = {
  moduleId: 7, moduleCode: "001", moduleName: "Módulo de ensayo", cycleName: "Ciclo",
  academicYear: "2026-2027", enabled: false, canConfigure: false, canReviewCurriculum: true,
  verificationCurrent: true, fingerprint: "fp", diagnostics: [], threads: [], sections: [], configuration: null,
} as ForumCollaboration;
const snapshot = {
  module: { id: 7 },
  configuration: { sourceTitle: "Referencia histórica", sourceUrl: "https://www.boe.es/ley" },
  outcomes: [{ id: 4, code: "RA1", description: "Texto de la revisión anterior", order: 1, deletedAt: null }],
  criteria: [{ id: 5, outcomeId: 4, code: "a", description: "Texto CE", order: 1, deletedAt: null }],
};
mocks.history = [{ revision: 3, actorName: "Coordinación histórica", createdAt: "2026-10-30T10:00:00.000Z" }];
mocks.historyDetail = JSON.stringify({
  curriculumReview: { kind: "selected_worksheet_changes", before: snapshot, after: snapshot },
});

describe("Historical curriculum recovery", () => {
  it("compares a selected past RA text and requires explicit confirmation before recovery", async () => {
    const queryClient = new QueryClient();
    render(<QueryClientProvider client={queryClient}><ForumCurriculumReview collab={collab} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("button-curriculum-review"));
    fireEvent.mouseDown(screen.getByTestId("tab-curriculum-history"), { button: 0 });
    await waitFor(() => expect(screen.getByTestId("tab-curriculum-history").getAttribute("aria-selected")).toBe("true"));
    fireEvent.click(await screen.findByText("Rev. 3"));

    expect(screen.getAllByText(/Coordinación histórica/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("select-curriculum-recovery-field")).toBeTruthy();
    fireEvent.change(screen.getByTestId("select-curriculum-recovery-field"), {
      target: { value: JSON.stringify(["ra", "RA1"]) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Comparar" }));
    await screen.findByText("Texto de la revisión anterior");
    expect(mocks.previewRecovery).toHaveBeenCalledWith({
      moduleId: 7,
      data: { sourceRevision: 3, sourceSide: "before", fieldKey: JSON.stringify(["ra", "RA1"]) },
    });
    const recoverButton = screen.getByTestId("button-curriculum-recover") as HTMLButtonElement;
    expect(recoverButton.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-curriculum-recovery-confirm"));
    fireEvent.click(recoverButton);
    await waitFor(() => expect(mocks.recoverText).toHaveBeenCalledWith({
      moduleId: 7,
      data: {
        sourceRevision: 3, sourceSide: "before", fieldKey: JSON.stringify(["ra", "RA1"]),
        token: "a".repeat(64), confirmReviewed: true,
      },
    }));
  });
});
