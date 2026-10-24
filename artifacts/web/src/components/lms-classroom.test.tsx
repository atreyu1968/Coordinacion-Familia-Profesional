import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LmsCourseDetail, LmsLesson } from "@workspace/api-client-react";
import { courseProgressStats, LmsClassroom, useLessonSelection } from "./lms-classroom";

function fixture(): LmsCourseDetail {
  return {
    id: 42, title: "Curso de prueba", description: "Formación del profesorado",
    status: "published", moduleId: null, certificateEnabled: true,
    lessonCount: 3, completed: false, certificateAvailable: false, progress: [],
    lessons: ["Primera lección", "Segunda lección", "Tercera lección"].map((title, index) => ({
      id: index + 1, courseId: 42, title, kind: index === 1 ? "quiz" : "text",
      required: true, position: index, objectName: null, objectContentType: null,
      objectSize: null, scormVersion: null, scormLaunchPath: null,
      content: { text: `Contenido exclusivo ${index + 1}` },
    })),
  };
}

function Lesson({ lesson }: { lesson: LmsLesson }) {
  const [answer, setAnswer] = useState("");
  return <><p>{String(lesson.content.text)}</p>
    <input aria-label="Respuesta de prueba" value={answer} onChange={(event) => setAnswer(event.target.value)} />
  </>;
}
function Classroom({ course }: { course: LmsCourseDetail }) {
  const [selected, select] = useLessonSelection(course);
  return <LmsClassroom course={course} selectedLessonId={selected} onSelect={select}
    renderLesson={(lesson) => <Lesson lesson={lesson} />} />;
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(cleanup);

describe("aula del curso", () => {
  it("shows only the selected lesson and navigation never completes lessons", () => {
    const course = fixture();
    render(<Classroom course={course} />);
    expect(screen.getByText("Contenido exclusivo 1")).toBeTruthy();
    expect(screen.queryByText("Contenido exclusivo 2")).toBeNull();
    const navigation = screen.getByRole("navigation", { name: "Navegación entre lecciones" });
    expect(within(navigation).getByRole("button", { name: /Anterior/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(within(navigation).getByRole("button", { name: /Siguiente/ }));
    expect(screen.getByText("Contenido exclusivo 2")).toBeTruthy();
    expect(screen.queryByText("Contenido exclusivo 1")).toBeNull();
    expect(course.progress).toEqual([]);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    fireEvent.click(within(navigation).getByRole("button", { name: /Siguiente/ }));
    expect(within(navigation).getByRole("button", { name: /Siguiente/ }).hasAttribute("disabled")).toBe(true);
  });

  it("allows curriculum selection and starts with the first incomplete lesson", () => {
    const course = fixture();
    course.progress = [{ lessonId: 1, status: "completed", score: null, attempts: 0, completedAt: null }];
    render(<Classroom course={course} />);
    expect(screen.getByText("Contenido exclusivo 2")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Tercera lección/ }));
    expect(screen.getByText("Contenido exclusivo 3")).toBeTruthy();
    expect(courseProgressStats(course).percent).toBe(33);
  });

  it("preserves selection and local answer state when server progress refreshes", () => {
    const course = fixture();
    const { rerender } = render(<Classroom course={course} />);
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Segunda lección/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Respuesta sin enviar" } });
    rerender(<Classroom course={{ ...course, progress: [
      { lessonId: 2, status: "completed", score: 100, attempts: 1, completedAt: null },
    ] }} />);
    expect(screen.getByText("Contenido exclusivo 2")).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Respuesta sin enviar");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
  });

  it("does not reuse quiz answers or other lesson-local state across lessons", () => {
    render(<Classroom course={fixture()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Respuesta de otra lección" } });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /Siguiente/ }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("resets selection when changing course and handles a deleted selected lesson", () => {
    const course = fixture();
    const { rerender } = render(<Classroom course={course} />);
    fireEvent.click(within(screen.getByRole("complementary")).getByRole("button", { name: /Tercera lección/ }));
    rerender(<Classroom course={{ ...course, lessons: course.lessons.slice(0, 2) }} />);
    expect(screen.getByText("Contenido exclusivo 1")).toBeTruthy();
    rerender(<Classroom course={{ ...course, id: 99, lessons: [course.lessons[1]] }} />);
    expect(screen.getByText("Contenido exclusivo 2")).toBeTruthy();
  });

  it("handles a course with no lessons without rendering navigation or content", () => {
    render(<Classroom course={{ ...fixture(), lessons: [], lessonCount: 0 }} />);
    expect(screen.getByText("Este curso todavía no tiene lecciones.")).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  });
});
