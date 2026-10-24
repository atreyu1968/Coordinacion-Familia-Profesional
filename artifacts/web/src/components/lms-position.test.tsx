import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultLmsLesson, useLmsLessonSelection, waitForLmsCoursePosition, setAuthTokenGetter,
  type LmsCourseDetail,
} from "@workspace/api-client-react";

const course: LmsCourseDetail = {
  id: 42, title: "Resume", description: "", moduleId: null, status: "published",
  certificateEnabled: true, lessonCount: 3, completed: false, certificateAvailable: false,
  lastOpenedLessonId: 3,
  progress: [{ lessonId: 1, status: "completed", attempts: 1, score: null, completedAt: null }],
  lessons: [1, 2, 3].map((id) => ({
    id, courseId: 42, title: `Lesson ${id}`, kind: "text", position: id, required: true,
    content: {}, objectName: null, objectContentType: null, objectSize: null,
    scormVersion: null, scormLaunchPath: null,
  })),
};
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  cleanup();
  await Promise.all([waitForLmsCoursePosition(42), waitForLmsCoursePosition(99)]);
  setAuthTokenGetter(null);
  vi.unstubAllGlobals();
});

describe("shared web/mobile lesson selection", () => {
  it("restores even a completed last-opened lesson and falls back to first pending, first lesson, or empty", () => {
    expect(defaultLmsLesson({ ...course, lastOpenedLessonId: 1 })).toBe(1);
    expect(defaultLmsLesson({ ...course, lastOpenedLessonId: 999 })).toBe(2);
    expect(defaultLmsLesson({ ...course, lastOpenedLessonId: null, progress: course.lessons.map((l) => ({
      lessonId: l.id, status: "completed", score: null, attempts: 1, completedAt: null,
    })) })).toBe(1);
    expect(defaultLmsLesson({ ...course, lessons: [] })).toBeNull();
  });

  it("does not overwrite a server position with stale cached data before the initial refetch finishes", async () => {
    const { result, rerender } = renderHook(
      ({ data, ready }) => useLmsLessonSelection(data, { persist: true, ready }),
      { initialProps: { data: { ...course, lastOpenedLessonId: 1 } as LmsCourseDetail, ready: false } },
    );
    expect(result.current[0]).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ data: course, ready: true });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current[0]).toBe(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ lessonId: 3 });
  });

  it("uses the same persisted selection after unmounting web and mounting mobile and back", async () => {
    let stored = course.lastOpenedLessonId;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      stored = JSON.parse(String(init.body)).lessonId;
      return new Response(null, { status: 204 });
    });
    const web = renderHook(() => useLmsLessonSelection(course, { persist: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => web.result.current[1](2));
    await waitFor(() => expect(stored).toBe(2));
    web.unmount();
    const mobile = renderHook(() => useLmsLessonSelection({ ...course, lastOpenedLessonId: stored }, { persist: true }));
    expect(mobile.result.current[0]).toBe(2);
    act(() => mobile.result.current[1](1));
    await waitFor(() => expect(stored).toBe(1));
    mobile.unmount();
    const returningWeb = renderHook(() => useLmsLessonSelection({ ...course, lastOpenedLessonId: stored }, { persist: true }));
    expect(returningWeb.result.current[0]).toBe(1);
    expect(course.progress).toHaveLength(1);
  });

  it("preserves the local selection on refetch, uses first pending on deletion and resets between courses", async () => {
    const { result, rerender } = renderHook(({ data }) => useLmsLessonSelection(data, { persist: true }), {
      initialProps: { data: course },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current[1](1));
    rerender({ data: { ...course, lastOpenedLessonId: 3 } });
    expect(result.current[0]).toBe(1);
    rerender({ data: { ...course, lessons: course.lessons.filter((l) => l.id !== 1) } });
    expect(result.current[0]).toBe(2);
    rerender({ data: { ...course, id: 99, lastOpenedLessonId: 3 } });
    expect(result.current[0]).toBe(3);
  });

  it("isolates preview navigation and draft management from both reading and saving a real position", async () => {
    const preview = renderHook(() => useLmsLessonSelection(course, { persist: false }));
    expect(preview.result.current[0]).toBe(2);
    act(() => preview.result.current[1](1));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    preview.unmount();
    const draft = renderHook(() => useLmsLessonSelection({ ...course, status: "draft" }, { persist: true }));
    act(() => draft.result.current[1](2));
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates the caller's cache after saving so returning from preview does not restore an older lesson", async () => {
    let cached = course;
    const { result, rerender } = renderHook(({ data }) => useLmsLessonSelection(data, {
      persist: true,
      onSaved: (_courseId, lessonId) => { cached = { ...cached, lastOpenedLessonId: lessonId }; },
    }), { initialProps: { data: course as LmsCourseDetail | undefined } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current[1](2));
    await waitFor(() => expect(cached.lastOpenedLessonId).toBe(2));
    rerender({ data: undefined });
    rerender({ data: cached });
    expect(result.current[0]).toBe(2);
  });

  it("serializes writes and exposes a failed save with a working retry", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    const { result } = renderHook(() => useLmsLessonSelection(course, { persist: true }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current[1](2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await act(async () => resolve(new Response(null, { status: 204 })));
    await waitFor(() => expect(result.current[2].error).toBe(true));
    expect(result.current[0]).toBe(2);
    act(() => result.current[2].retry());
    await waitFor(() => expect(result.current[2].error).toBe(false));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ lessonId: 2 });
  });

  it.each(["unmount", "preview", "change course"])(
    "drains the last queued selection after %s, pins its identity and makes re-entry wait",
    async (exit) => {
      let finishFirst!: (response: Response) => void;
      let token = "session-A";
      setAuthTokenGetter(() => token);
      const onSaved = vi.fn();
      fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishFirst = resolve; }));
      const { result, rerender, unmount } = renderHook(
        ({ data }) => useLmsLessonSelection(data, { persist: true, onSaved }),
        { initialProps: { data: course as LmsCourseDetail | undefined } },
      );
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      act(() => result.current[1](2));
      // The second request is accepted locally but blocked behind the first.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      token = "session-B";
      if (exit === "unmount") unmount();
      else rerender({ data: exit === "preview" ? undefined : { ...course, id: 99 } });
      let drained = false;
      const reentry = waitForLmsCoursePosition(42).then(() => { drained = true; });
      await act(async () => {});
      expect(drained).toBe(false);
      await act(async () => {
        finishFirst(new Response(null, { status: 204 }));
        await reentry;
      });
      const writes = fetchMock.mock.calls.filter(([url]) => String(url).includes("/courses/42/"));
      expect(writes.map(([, init]) => JSON.parse(init.body).lessonId)).toEqual([3, 2]);
      for (const [, init] of writes) {
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-A");
      }
      expect(drained).toBe(true);
      expect(onSaved.mock.calls.filter(([id]) => id === 42)).toEqual([]);
    },
  );
});
