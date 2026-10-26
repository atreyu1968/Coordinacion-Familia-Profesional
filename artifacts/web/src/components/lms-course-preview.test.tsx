import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LmsCourseDetail, LmsLesson } from "@workspace/api-client-react";
import { LmsCoursePreview } from "./lms-course-preview";
import { LessonView } from "@/pages/autodirigido";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(), quiz: vi.fn(), scorm: vi.fn(), commit: vi.fn(), toast: vi.fn(),
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useCompleteLmsLesson: () => ({ mutateAsync: mocks.complete }),
  useSubmitLmsQuizAttempt: () => ({ mutateAsync: mocks.quiz }),
  useCreateLmsLessonDownloadToken: () => ({ mutateAsync: vi.fn() }),
  useCreateLmsLessonScormSession: () => ({ mutateAsync: mocks.scorm }),
  useCommitLmsScormSession: () => ({ mutateAsync: mocks.commit }),
  getGetLmsCourseQueryKey: (id: number) => ["course", id],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));

function fixture(kind: LmsLesson["kind"] = "text"): LmsCourseDetail {
  return {
    id: 42, title: "Curso borrador", description: "Descripción visible",
    status: "draft", moduleId: null, certificateEnabled: true,
    lessonCount: 1, completed: true, certificateAvailable: true, lastOpenedLessonId: 7,
    progress: [{ lessonId: 7, status: "completed", score: 100, attempts: 9, completedAt: null }],
    lessons: [{
      id: 7, courseId: 42, title: "Primera lección", kind, required: true, position: 0,
      objectName: null, objectContentType: null, objectSize: null,
      scormVersion: null, scormLaunchPath: null,
      content: kind === "quiz" ? { questions: [{ prompt: "¿Dos más dos?", options: ["Cuatro", "Cinco"], correctIndex: 0 }] } : { text: "Texto de la lección" },
    }],
  };
}
function Preview({ course = fixture(), onClose = vi.fn() }) {
  return <LmsCoursePreview course={course} onClose={onClose}
    renderLesson={(view, lesson, onProgress) =>
      <LessonView course={view} lesson={lesson} onRefresh={vi.fn()} onPreviewProgress={onProgress} />}
  />;
}

describe("vista previa de cursos como alumno", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scorm.mockResolvedValue({ token: "preview", version: "1.2", launchPath: "about:blank", cmiData: {} });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("muestra el contenido sin controles de gestión ni progreso real", () => {
    render(<Preview />);
    expect(screen.getByText("Vista previa como alumno")).toBeTruthy();
    expect(screen.getByText("Texto de la lección")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publicar|Editar|Eliminar|Exportar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Descargar certificado" })).toBeNull();
  });

  it.each(["text", "quiz"] as const)("muestra una sola vez el título de la lección %s", (kind) => {
    render(<Preview course={fixture(kind)} />);
    expect(screen.getAllByRole("heading", { name: "Primera lección" })).toHaveLength(1);
  });

  it("simula la finalización y no solicita certificados ni guarda progreso", () => {
    const course = fixture();
    render(<Preview course={course} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar como completada" }));
    expect(screen.getByText("100%")).toBeTruthy();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(screen.queryByText(/certificad|certificaci[oó]n/i)).toBeNull();
    expect(course.status).toBe("draft");
    expect(course.progress[0].attempts).toBe(9);
  });

  it("corrige el cuestionario solo en memoria", () => {
    render(<Preview course={fixture("quiz")} />);
    fireEvent.click(screen.getByLabelText("Cuatro"));
    fireEvent.click(screen.getByRole("button", { name: "Enviar respuestas" }));
    expect(screen.getByText("100%")).toBeTruthy();
    expect(mocks.quiz).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "¡Cuestionario superado!" }));
  });

  it("abre SCORM con una sesión de vista previa y no confirma progreso", async () => {
    render(<Preview course={fixture("scorm12")} />);
    await waitFor(() => expect(screen.getByTitle("Contenido SCORM")).toBeTruthy());
    expect(mocks.scorm).toHaveBeenCalledWith({ lessonId: 7, params: { preview: true } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar progreso SCORM" }));
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("abre SCORM a pantalla completa y permite volver sin recargar el paquete", async () => {
    render(<Preview course={fixture("scorm12")} />);
    const frame = await screen.findByTitle("Contenido SCORM");
    const player = screen.getByRole("region", { name: "Reproductor SCORM" });
    expect(player.getAttribute("data-fullscreen")).toBe("true");
    expect(frame.hasAttribute("allowfullscreen")).toBe(true);
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    fireEvent.click(screen.getByRole("button", { name: "Volver al curso" }));
    await waitFor(() => expect(player.getAttribute("data-fullscreen")).toBe("false"));
    expect(screen.getByTitle("Contenido SCORM")).toBe(frame);
    expect(document.body.style.overflow).not.toBe("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Ver SCORM a pantalla completa" }));
    expect(player.getAttribute("data-fullscreen")).toBe("true");
    expect(screen.getByTitle("Contenido SCORM")).toBe(frame);
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it.each([true, false])("confirma al móvil el resultado del guardado antes de cerrar: %s", async (success) => {
    const postMessage = vi.fn();
    vi.stubGlobal("ReactNativeWebView", { postMessage });
    if (success) mocks.commit.mockResolvedValue({});
    else mocks.commit.mockRejectedValue(new Error("Sin conexión"));
    const course = fixture("scorm12");
    render(<LessonView course={course} lesson={course.lessons[0]} onRefresh={vi.fn()} />);
    await screen.findByTitle("Contenido SCORM");
    await waitFor(() => expect((screen.getByRole("button", { name: "Guardar progreso SCORM" }) as HTMLButtonElement).disabled).toBe(false));
    window.dispatchEvent(new Event("coordina-scorm-save-request"));
    await waitFor(() => expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "scorm-save", ok: success })));
    expect(mocks.commit).toHaveBeenCalled();
  });

  it("permite salir y reinicia la simulación al volver a entrar", () => {
    const onClose = vi.fn();
    const view = render(<Preview onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Marcar como completada" }));
    fireEvent.click(screen.getByRole("button", { name: "Volver a la gestión" }));
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    render(<Preview />);
    expect(screen.getByText("0%")).toBeTruthy();
  });
});
