import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutodirigidoPage from "./autodirigido";
import type { LmsCourseDetail } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  canManage: true,
  courseDetail: undefined as LmsCourseDetail | undefined,
  downloadedFiles: [] as string[],
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  LmsLessonInputKind: {},
  useCompleteLmsLesson: vi.fn(),
  useCreateLmsCourse: vi.fn(),
  useDeleteLmsCourse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateLmsLesson: vi.fn(),
  useCreateLmsLessonDownloadToken: vi.fn(),
  useCreateLmsLessonScormSession: vi.fn(),
  useGetLmsCourse: () => ({ data: mocks.courseDetail, isLoading: false, refetch: vi.fn() }),
  useGetLmsManagementScopes: () => ({
    data: [{ canManage: mocks.canManage, moduleId: 10 }],
  }),
  useImportLmsCourseArchive: vi.fn(),
  useListLmsCourses: () => ({
    data: [{
      id: 101,
      title: "Gestión administrativa",
      description: "Curso de prueba",
      moduleId: 10,
      status: "published",
      lessonCount: 0,
      completed: false,
    }],
    isLoading: false,
  }),
  usePublishLmsCourse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRequestLmsUploadUrl: vi.fn(),
  useRequestLmsCourseImportUploadUrl: vi.fn(),
  useSubmitLmsQuizAttempt: vi.fn(),
  useUpdateLmsCourse: vi.fn(),
  useUpdateLmsLesson: vi.fn(),
  useCommitLmsScormSession: vi.fn(),
  useGetLmsScormSession: vi.fn(),
  downloadLmsCertificate: vi.fn(),
  getListLmsCoursesQueryKey: () => ["lms-courses"],
  getGetLmsCourseQueryKey: (courseId: number) => ["lms-course", courseId],
  getGetLmsScormSessionQueryKey: (params: unknown) => ["lms-scorm-session", params],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

describe("exportación de cursos autodirigidos", () => {
  let originalCreateObjectURL: PropertyDescriptor | undefined;
  let originalRevokeObjectURL: PropertyDescriptor | undefined;
  let originalAnchorClick: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canManage = true;
    mocks.courseDetail = undefined;
    originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    originalAnchorClick = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "click");

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:exportacion-de-prueba"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLAnchorElement.prototype, "click", {
      configurable: true,
      value: vi.fn(function (this: HTMLAnchorElement) {
        mocks.downloadedFiles.push(this.download);
      }),
    });
    mocks.downloadedFiles.length = 0;
    localStorage.setItem("coordina_adg_token", "test-token");
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    for (const [key, descriptor] of [
      ["createObjectURL", originalCreateObjectURL],
      ["revokeObjectURL", originalRevokeObjectURL],
    ] as const) {
      if (descriptor) Object.defineProperty(URL, key, descriptor);
      else delete (URL as unknown as Record<string, unknown>)[key];
    }
    if (originalAnchorClick) {
      Object.defineProperty(HTMLAnchorElement.prototype, "click", originalAnchorClick);
    } else {
      delete (HTMLAnchorElement.prototype as unknown as Record<string, unknown>).click;
    }
  });

  it("ofrece eliminar cursos del ámbito que puede gestionar", () => {
    render(<AutodirigidoPage />);
    expect(screen.getByRole("button", { name: "Eliminar curso Gestión administrativa" })).toBeTruthy();
  });

  it("abre la vista previa desde el borrador y permite volver a la gestión", () => {
    mocks.courseDetail = {
      id: 101, title: "Gestión administrativa", description: "Curso de prueba",
      moduleId: 10, status: "draft", certificateEnabled: false,
      lessonCount: 0, completed: false, certificateAvailable: false, lessons: [], progress: [], lastOpenedLessonId: null,
    };
    window.history.replaceState({}, "", "/autodirigido?curso=101");
    render(<AutodirigidoPage />);
    fireEvent.click(screen.getByRole("button", { name: "Vista previa como alumno" }));
    expect(screen.getByText("Este curso todavía no tiene lecciones.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Publicar curso" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Volver a la gestión" }));
    expect(screen.getByRole("button", { name: "Publicar curso" })).toBeTruthy();
    window.history.replaceState({}, "", "/");
  });

  it("no ofrece eliminar un curso sin permisos de gestión", () => {
    mocks.canManage = false;
    render(<AutodirigidoPage />);
    expect(screen.queryByRole("button", { name: /Eliminar curso/ })).toBeNull();
  });

  it("descarga el ZIP y avisa del nombre y motivo de cada curso excluido", async () => {
    const archive = new JSZip();
    archive.file("informe-exportacion.json", JSON.stringify({
      included: [{ id: 101 }],
      excluded: [
        { title: "Atención al cliente", reason: "Falta un archivo obligatorio." },
        { title: "Contabilidad básica", reason: "El curso no está disponible." },
      ],
    }));
    const zipBlob = await archive.generateAsync({ type: "blob" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => zipBlob,
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AutodirigidoPage />);

    fireEvent.click(screen.getByRole("checkbox", {
      name: "Seleccionar Gestión administrativa para exportar",
    }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Exportar selección" }));
    });

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/lms/courses/export"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
        body: JSON.stringify({ courseIds: [101] }),
      }),
    );
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(mocks.downloadedFiles).toEqual(["coordina-cursos.zip"]);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Exportación parcial: 1 curso(s) incluidos",
      description: [
        "Atención al cliente: Falta un archivo obligatorio.",
        "Contabilidad básica: El curso no está disponible.",
      ].join("\n"),
      variant: "destructive",
    });
  });
});
