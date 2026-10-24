import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextcloudViewer } from "../../../movil/components/NextcloudViewer.web";

vi.mock("react-native-webview", () => {
  throw new Error("The PWA must not load native WebView");
});

afterEach(cleanup);

const props = () => ({
  url: "https://app.example.test/api/nextcloud/sso?ticket=consumed",
  nextcloudUrl: "https://cloud.example.test",
  title: "Administración",
  onError: vi.fn(),
  requestFreshUrl: vi.fn().mockResolvedValue("https://app.example.test/api/nextcloud/sso?ticket=fresh"),
});

describe("Nextcloud PWA viewer", () => {
  it("renders an authenticated iframe instead of native WebView", () => {
    const input = props();
    render(<NextcloudViewer {...input} />);
    const frame = screen.getByTitle("Archivos de Administración");
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe(input.url);
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(input.requestFreshUrl).not.toHaveBeenCalled();
  });

  it("opens a fresh one-use ticket rather than reusing the iframe ticket", async () => {
    const input = props();
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    render(<NextcloudViewer {...input} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith(
      "https://app.example.test/api/nextcloud/sso?ticket=fresh",
    ));
    expect(input.requestFreshUrl).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
  });

  it("reports popup blocking without consuming another ticket", () => {
    const input = props();
    vi.spyOn(window, "open").mockReturnValue(null);
    render(<NextcloudViewer {...input} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("alert").textContent).toContain("ventanas emergentes");
    expect(input.requestFreshUrl).not.toHaveBeenCalled();
  });

  it("closes the blank tab when access has been revoked", async () => {
    const input = props();
    input.requestFreshUrl.mockRejectedValue(new Error("403"));
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    render(<NextcloudViewer {...input} />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("permisos");
  });
});
