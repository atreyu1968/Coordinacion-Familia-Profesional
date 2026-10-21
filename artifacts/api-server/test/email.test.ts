import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmailLayout, emailLink } from "../src/lib/email-layout";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(), configured: vi.fn(), getFile: vi.fn(), download: vi.fn(),
}));
vi.mock("../src/lib/settings", () => ({
  getSettings: mocks.getSettings,
  isResendConfigured: mocks.configured,
  DEFAULT_PROFESSIONAL_FAMILY: "Administración y Gestión",
  professionalFamilyOf: (settings: { professionalFamily?: string }) => settings.professionalFamily || "Administración y Gestión",
}));
vi.mock("../src/lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile = mocks.getFile;
    downloadObject = mocks.download;
  },
}));

import {
  sendEmail, buildPasswordResetEmail, buildInvitationEmail,
  buildCompanyAlertEmail, buildYearConfirmationEmail, buildAccreditationEmail,
} from "../src/lib/email";

const settings = {
  appName: "Coordinación FP", professionalFamily: "Administración y Gestión",
  logoPath: null as string | null, updatedAt: new Date(0),
  resendApiKey: "test-key-not-a-credential", resendFromEmail: "App <noreply@example.test>",
};
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=";
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ ...settings });
  mocks.configured.mockReturnValue(true);
  fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"test-message"}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("branded email templates", () => {
  it("provides a responsive table layout, escaped branding and equivalent plain text", () => {
    const result = buildEmailLayout({
      appName: 'Mi app <script>alert(1)</script>', professionalFamily: "A & B",
      subject: "Un aviso", content: '<h2>Acceso</h2><p>Código: 123456</p>',
    });
    expect(result.html).toContain('<html lang="es">');
    expect(result.html).toContain('role="presentation"');
    expect(result.html).toContain('cid:application-logo');
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("A &amp; B");
    expect(result.text).toContain("Código: 123456");
    expect(result.text).not.toContain("<h2>");
    expect(() => emailLink("javascript:alert(1)")).toThrow();
    expect(() => emailLink("https://user:password@example.test")).toThrow();
  });

  it("uses the configured name and embeds the default logo, QR and PDF without changing their contents", async () => {
    const body = buildPasswordResetEmail({ code: "123456" });
    const result = await sendEmail({
      to: "recipient@example.test", ...body,
      html: `${body.html}<img src="data:image/png;base64,${png}" alt="QR">`,
      attachments: [{ filename: "certificado.pdf", content: "JVBERi0=" }],
    });
    expect(result).toEqual({ sent: true, pending: false });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.subject).toContain("Coordinación FP");
    expect(payload.html).toContain("Coordinación FP");
    expect(payload.text).toContain("123456");
    expect(payload.html).toContain("cid:message-image-1");
    expect(payload.html).not.toContain("data:image");
    expect(payload.attachments).toHaveLength(3);
    expect(payload.attachments[0].content_id).toBe("application-logo");
    expect(Buffer.from(payload.attachments[0].content, "base64").subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71]));
    expect(payload.attachments[1].content).toBe(png);
    expect(payload.attachments[2]).toEqual({ filename: "certificado.pdf", content: "JVBERi0=" });
  });

  it("embeds a custom logo from private storage rather than relying on a public URL", async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, logoPath: "/objects/uploads/custom-email-logo" });
    mocks.getFile.mockResolvedValue({ testFile: true });
    mocks.download.mockResolvedValue(new Response(Buffer.from(png, "base64")));
    expect((await sendEmail({ to: "recipient@example.test", ...buildPasswordResetEmail({ code: "123456" }) })).sent).toBe(true);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.attachments[0].content).toBe(png);
    expect(mocks.getFile).toHaveBeenCalledWith("/objects/uploads/custom-email-logo");
    expect(payload.html).not.toContain("/objects/uploads/");
  });

  it("does not read unsafe paths or block essential mail when a custom logo is unavailable", async () => {
    mocks.getSettings.mockResolvedValue({ ...settings, logoPath: "/objects/uploads/../secret" });
    expect((await sendEmail({ to: "recipient@example.test", ...buildPasswordResetEmail({ code: "123456" }) })).sent).toBe(true);
    expect(mocks.getFile).not.toHaveBeenCalled();
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload.attachments[0].filename).toBe("application-logo.png");
  });

  it("escapes user-supplied fields in every template and keeps actionable links and OTPs", () => {
    const unsafe = '<img src=x onerror="alert(1)">';
    const templates = [
      buildCompanyAlertEmail({ companyName: unsafe, sector: unsafe, description: unsafe, contact: unsafe }),
      buildInvitationEmail({ inviterName: unsafe, inviteUrl: "https://example.test/register?token=example", role: "teacher" }),
      buildYearConfirmationEmail({ teacherName: unsafe, schoolYear: unsafe, deadline: new Date(), appUrl: "https://example.test" }),
      buildAccreditationEmail({ eventName: unsafe, holderName: unsafe, role: unsafe, qrToken: unsafe, qrDataUrl: `data:image/png;base64,${png}` }),
      buildPasswordResetEmail({ code: unsafe }),
    ];
    for (const email of templates) {
      expect(email.html).not.toContain(unsafe);
      expect(email.html).toContain("&lt;img");
    }
    expect(templates[1].html).toContain("Completar registro");
    expect(templates[2].html).toContain("Confirmar ahora");
    expect(buildPasswordResetEmail({ code: "123456" }).html).toContain("15 minutos");
    expect(() => buildAccreditationEmail({
      eventName: "Evento", holderName: "Persona", role: "participant",
      qrToken: "example", qrDataUrl: '" onerror="alert(1)',
    })).toThrow("Invalid accreditation QR image");
  });

  it("does not send mail when delivery is unconfigured and reports provider failures", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await sendEmail({ to: "recipient@example.test", subject: "Test", html: "<p>Test</p>" }))
      .toEqual({ sent: false, pending: true });
    expect(fetchMock).not.toHaveBeenCalled();
    mocks.configured.mockReturnValue(true);
    fetchMock.mockResolvedValue(new Response("Unavailable", { status: 503 }));
    expect(await sendEmail({ to: "recipient@example.test", subject: "Test", html: "<p>Test</p>" }))
      .toEqual({ sent: false, pending: false });
  });
});
