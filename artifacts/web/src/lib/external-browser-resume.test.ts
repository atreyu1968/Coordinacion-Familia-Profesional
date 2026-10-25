import { beforeEach, describe, expect, it } from "vitest";
import {
  beginExternalBrowserOpen,
  clearExternalBrowserResumeExemption,
  consumeExternalBrowserResumeExemption,
} from "../../../movil/lib/external-browser-resume";

const RESUME_MARKER_KEY = "coordina_adg_external_browser_resume";

describe("external browser biometric resume", () => {
  beforeEach(() => {
    clearExternalBrowserResumeExemption();
    window.sessionStorage.clear();
  });

  it("skips the lock when the app resumes while an opened browser is active", () => {
    const finish = beginExternalBrowserOpen();

    expect(consumeExternalBrowserResumeExemption()).toBe(true);
    finish(true);
    expect(consumeExternalBrowserResumeExemption()).toBe(false);
  });

  it("allows one short resume window after the browser tab closes", () => {
    const finish = beginExternalBrowserOpen();
    finish(true);

    expect(consumeExternalBrowserResumeExemption()).toBe(true);
    expect(consumeExternalBrowserResumeExemption()).toBe(false);
  });

  it("restores one exemption after a PWA reload while the browser handoff is pending", () => {
    window.sessionStorage.setItem(
      RESUME_MARKER_KEY,
      String(Date.now() + 30_000),
    );

    expect(consumeExternalBrowserResumeExemption()).toBe(true);
    expect(consumeExternalBrowserResumeExemption()).toBe(false);
  });

  it("clears the pending exemption when signing out", () => {
    beginExternalBrowserOpen();
    clearExternalBrowserResumeExemption();

    expect(consumeExternalBrowserResumeExemption()).toBe(false);
  });
});
