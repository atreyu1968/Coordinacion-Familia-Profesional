import { useEffect, useRef, useState } from "react";
import type { LmsCourseDetail } from "./generated/api.schemas";
import { saveLmsCoursePosition } from "./generated/api";
import { captureAuthHeaders } from "./custom-fetch";

// Survives course navigation and hook unmounts. Reads on re-entry wait for the
// pending writes, rather than hydrating from a position that is still being saved.
const pendingPositions = new Map<number, Promise<void>>();
export async function waitForLmsCoursePosition(courseId: number): Promise<void> {
  let pending = pendingPositions.get(courseId);
  while (pending) {
    await pending;
    pending = pendingPositions.get(courseId);
  }
}

export function defaultLmsLesson(course: LmsCourseDetail, resume = true): number | null {
  if (resume && course.lessons.some((lesson) => lesson.id === course.lastOpenedLessonId)) {
    return course.lastOpenedLessonId;
  }
  return (course.lessons.find((lesson) =>
    !course.progress.some((p) => p.lessonId === lesson.id && p.status === "completed"),
  ) ?? course.lessons[0])?.id ?? null;
}

/** Shared by web and mobile. Preview must opt out of both reading and writing position. */
export function useLmsLessonSelection(
  course: LmsCourseDetail | undefined,
  { persist = false, ready = true, onSaved }: {
    persist?: boolean;
    ready?: boolean;
    onSaved?: (courseId: number, lessonId: number) => void;
  } = {},
) {
  const [selection, setSelection] = useState<{ courseId: number; lessonId: number | null } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Serialize rapid selections so a slow earlier request cannot overwrite a later one.
  const generation = useRef(0);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const courseId = course?.id;
  useEffect(() => {
    generation.current++;
    setSelection(null);
    setError(false);
  }, [courseId, persist]);
  let selected = selection && selection.courseId === courseId ? selection.lessonId : null;
  if (course && (selection?.courseId === courseId || ready)) {
    if (!course.lessons.some((lesson) => lesson.id === selected)) {
      selected = defaultLmsLesson(course, persist && selection?.courseId !== courseId);
    }
  }
  useEffect(() => {
    if (course && (selection?.courseId === course.id || ready)) {
      if (selection?.courseId !== course.id || selection.lessonId !== selected) {
        setSelection({ courseId: course.id, lessonId: selected });
      }
    }
  }, [course, selected, ready, selection]);
  const canSave = persist && course?.status === "published";
  useEffect(() => {
    if (!canSave || !courseId || selected == null) return;
    const current = generation.current;
    setError(false);
    // Capture auth now: queued work must never borrow a newly signed-in user's token.
    const auth = captureAuthHeaders().then(
      (headers) => ({ ok: true, headers } as const),
      () => ({ ok: false } as const),
    );
    const pending = (pendingPositions.get(courseId) ?? Promise.resolve()).then(async () => {
      try {
        const captured = await auth;
        if (!captured.ok) throw new Error("No se pudo identificar la sesión de lectura");
        await saveLmsCoursePosition(courseId, { lessonId: selected }, { headers: captured.headers });
        if (generation.current === current) {
          setError(false);
          savedCallback.current?.(courseId, selected);
        }
      } catch {
        if (generation.current === current) setError(true);
      }
    });
    pendingPositions.set(courseId, pending);
    void pending.then(() => {
      if (pendingPositions.get(courseId) === pending) pendingPositions.delete(courseId);
    });
  }, [canSave, courseId, selected, retry]);
  useEffect(() => () => { generation.current++; }, []);
  return [
    selected,
    (lessonId: number) => {
      if (course?.lessons.some((lesson) => lesson.id === lessonId)) {
        setSelection({ courseId: course.id, lessonId });
      }
    },
    { error, retry: () => setRetry((value) => value + 1) },
  ] as const;
}
