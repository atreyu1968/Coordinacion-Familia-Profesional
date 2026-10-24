import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { CourseCover } from "./lms-classroom";
import { LmsCourseCoverField } from "./lms-course-cover-field";

const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const fetchImage = vi.fn();
beforeEach(() => {
  createObjectURL.mockReset().mockReturnValue("blob:course-cover");
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  fetchImage.mockReset().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } }));
  vi.stubGlobal("fetch", fetchImage);
  setAuthTokenGetter(() => "test-session-token");
});
afterEach(() => {
  cleanup();
  setAuthTokenGetter(null);
  vi.unstubAllGlobals();
});

describe("course cover", () => {
  it("fetches with the session bearer token, displays the returned blob and releases old images", async () => {
    const { container, rerender } = render(<CourseCover course={{ id: 1, title: "Curso propio", coverUrl: "/api/lms/courses/1/cover?v=a" }} />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(fetchImage).toHaveBeenCalledOnce();
    const [url, options] = fetchImage.mock.calls[0]!;
    expect(url).toBe("/api/lms/courses/1/cover");
    expect(new Headers(options.headers).get("Authorization")).toBe("Bearer test-session-token");
    expect(options.cache).toBe("no-store");
    expect(createObjectURL.mock.calls[0]![0]).toBeInstanceOf(Blob);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("blob:course-cover");
    expect(image.className).toContain("object-cover");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("CP");
    createObjectURL.mockReturnValue("blob:new-cover");
    rerender(<CourseCover course={{ id: 1, title: "Curso propio", coverUrl: "/api/lms/courses/1/cover?v=b" }} />);
    await waitFor(() => expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:new-cover"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:course-cover");
    rerender(<CourseCover course={{ id: 1, title: "Curso propio", coverUrl: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:new-cover");
  });
  it("keeps the alternative cover when the authenticated request is rejected", async () => {
    fetchImage.mockResolvedValueOnce(new Response("", { status: 401 }));
    const { container } = render(<CourseCover course={{ id: 1, title: "Curso propio", coverUrl: "/api/lms/courses/1/cover?v=a" }} />);
    await waitFor(() => expect(fetchImage).toHaveBeenCalledOnce());
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("CP");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("aborts an unfinished request on unmount instead of creating a stale object URL", async () => {
    let finish: (response: Response) => void;
    fetchImage.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    const { unmount } = render(<CourseCover course={{ id: 1, title: "Curso propio", coverUrl: "/api/lms/courses/1/cover?v=a" }} />);
    await waitFor(() => expect(fetchImage).toHaveBeenCalledOnce());
    unmount();
    expect(fetchImage.mock.calls[0]![1].signal.aborted).toBe(true);
    finish!(new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/webp" } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createObjectURL).not.toHaveBeenCalled();
  });
  it("rejects unsupported and oversized files before starting an upload", () => {
    const onFile = vi.fn();
    render(<LmsCourseCoverField course={null} title="Curso" file={null} removed={false} disabled={false} onFile={onFile} onRemove={vi.fn()} />);
    const input = screen.getByLabelText("Portada del curso");
    fireEvent.change(input, { target: { files: [new File(["svg"], "a.svg", { type: "image/svg+xml" })] } });
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("hasta 5 MB");
    const large = new File(["a"], "a.png", { type: "image/png" });
    Object.defineProperty(large, "size", { value: 6 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [large] } });
    expect(onFile).not.toHaveBeenCalled();
    const png = new File(["png"], "a.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [png] } });
    expect(onFile).toHaveBeenCalledWith(png);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("lets a manager choose the alternative cover without uploading", () => {
    const onRemove = vi.fn();
    render(<LmsCourseCoverField course={{
      id: 1, title: "Curso", description: "", moduleId: null, status: "draft",
      certificateEnabled: false, completed: false, certificateAvailable: false, lessonCount: 0,
      coverUrl: "/api/lms/courses/1/cover?v=a",
    }} title="Curso" file={null} removed={false} disabled={false} onFile={vi.fn()} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Usar portada alternativa" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
