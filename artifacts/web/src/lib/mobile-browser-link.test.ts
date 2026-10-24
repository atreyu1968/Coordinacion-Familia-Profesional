import { describe, expect, it, vi } from "vitest";
import { openBrowserLink } from "../../../movil/lib/browser-link.web";
import { validateBrowserUrl } from "../../../movil/lib/browser-link.types";

describe("mobile PWA browser links", () => {
  it("reserves a window before requesting a protected URL", async () => {
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const source = vi.fn(async () => {
      expect(open).toHaveBeenCalledWith("about:blank", "_blank");
      expect(tab.opener).toBeNull();
      return "https://app.example.test/scorm-player?token=test";
    });
    await openBrowserLink(source);
    expect(source).toHaveBeenCalledTimes(1);
    expect(tab.location.replace).toHaveBeenCalledWith("https://app.example.test/scorm-player?token=test");
  });
  it("reports blocked windows without requesting a protected URL", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const source = vi.fn();
    await expect(openBrowserLink(source)).rejects.toThrow("ventanas emergentes");
    expect(source).not.toHaveBeenCalled();
  });
  it("closes the reserved window on server failure", async () => {
    const tab = { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    await expect(openBrowserLink(async () => { throw new Error("Sin permiso"); })).rejects.toThrow("Sin permiso");
    expect(tab.close).toHaveBeenCalledOnce();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });
  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello", "https://user:password@example.test"])(
    "rejects unsafe external destinations: %s", (url) => {
      expect(() => validateBrowserUrl(url)).toThrow();
    },
  );
});
