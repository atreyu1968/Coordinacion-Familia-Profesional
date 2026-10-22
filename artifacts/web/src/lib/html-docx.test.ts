import { readFileSync } from "node:fs";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HtmlDocxDownloadButton, isHtmlDocumentName } from "@/components/html-docx-download-button";
import { createHtmlDocx } from "@/lib/html-docx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function getDocxFiles(html: string, fileName = "material.html") {
  const blob = await createHtmlDocx(html, fileName);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe("createHtmlDocx", () => {
  it("preserves headings, lists, links, and table content in a valid DOCX", async () => {
    const zip = await getDocxFiles(`
      <h1>Heading from HTML</h1>
      <ul><li>Bullet item</li></ul>
      <ol><li>Numbered item</li></ol>
      <p><a href="https://example.test/guide">Helpful link</a></p>
      <p><a href="javascript:window.alert(1)">Unsafe URL label</a></p>
      <table>
        <thead><tr><th>Column heading</th><th>Second heading</th></tr></thead>
        <tbody><tr><td>Cell value</td><td>Another cell</td></tr></tbody>
      </table>
    `);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const relationshipsXml = await zip.file("word/_rels/document.xml.rels")!.async("string");

    expect(documentXml).toContain("material");
    expect(documentXml).toContain("Heading from HTML");
    expect(documentXml).toContain("Bullet item");
    expect(documentXml).toContain("Numbered item");
    expect(documentXml).toContain("Helpful link");
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("Column heading");
    expect(documentXml).toContain("Cell value");
    expect(documentXml).toContain("<w:hyperlink");
    expect(documentXml).toContain("Unsafe URL label");
    expect(relationshipsXml).toContain("https://example.test/guide");
    expect(relationshipsXml).not.toContain("javascript:");
  });

  it("omits scripts, hidden content, and interactive controls without running script or event code", async () => {
    const zip = await getDocxFiles(`
      <script>window.__htmlDocxScriptRan = true; document.body.append("SCRIPT_MARKER");</script>
      <p onclick="window.__htmlDocxEventRan = true">Readable paragraph</p>
      <form><label>Private form label</label><input value="CONTROL_VALUE"><button>CONTROL_BUTTON</button></form>
      <select><option>SELECT_OPTION</option></select>
      <textarea>TEXTAREA_VALUE</textarea>
      <nav>NAV_CONTENT</nav>
      <video controls>VIDEO_CONTENT</video>
      <div hidden>HIDDEN_CONTENT</div>
      <div aria-hidden="true">ARIA_HIDDEN_CONTENT</div>
    `);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(documentXml).toContain("Readable paragraph");
    for (const omittedText of [
      "SCRIPT_MARKER",
      "Private form label",
      "CONTROL_VALUE",
      "CONTROL_BUTTON",
      "SELECT_OPTION",
      "TEXTAREA_VALUE",
      "NAV_CONTENT",
      "VIDEO_CONTENT",
      "HIDDEN_CONTENT",
      "ARIA_HIDDEN_CONTENT",
    ]) {
      expect(documentXml).not.toContain(omittedText);
    }
    expect((window as Window & { __htmlDocxScriptRan?: boolean }).__htmlDocxScriptRan).toBeUndefined();
    expect((window as Window & { __htmlDocxEventRan?: boolean }).__htmlDocxEventRan).toBeUndefined();
  });
});

describe("HTML DOCX download button", () => {
  it("recognizes HTML extensions case-insensitively and rejects other files", () => {
    expect(isHtmlDocumentName("guide.html")).toBe(true);
    expect(isHtmlDocumentName("guide.HTM")).toBe(true);
    expect(isHtmlDocumentName("guide.html.exe")).toBe(false);
    expect(isHtmlDocumentName("guide.docx")).toBe(false);
  });

  it("loads the protected source and downloads a converted DOCX using the original base name", async () => {
    const loadHtml = vi.fn(async () => new Blob(["<h1>From attachment</h1>"], { type: "text/html" }));
    const createObjectURL = vi.fn(() => "blob:converted-docx");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(createElement(HtmlDocxDownloadButton, {
      fileName: "Case file.HTM",
      loadHtml,
      testId: "download-docx",
    }));
    fireEvent.click(screen.getByTestId("download-docx"));

    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    expect(loadHtml).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClick.mock.instances[0]?.download).toBe("Case file.docx");
  });
});

describe("HTML attachment download surfaces", () => {
  const cases = [
    {
      surface: "documentation",
      file: "../pages/documentacion.tsx",
      docxButton: "button-download-wiki-attachment-docx",
      originalButton: "button-download-wiki-attachment-",
      requiredFragments: [
        "api/wiki/attachments/${attachment.id}/download",
        "{ headers: authHeaders() }",
      ],
    },
    {
      surface: "lessons",
      file: "../pages/autodirigido.tsx",
      docxButton: "button-download-lesson-docx",
      originalButton: "Descargar ${lesson.objectName",
      requiredFragments: [
        'lesson.kind === "file" && isHtmlDocumentName',
        "download.mutateAsync({ lessonId: lesson.id })",
        "apiUrl(result.url)",
      ],
    },
    {
      surface: "announcements",
      file: "../pages/anuncios.tsx",
      docxButton: "button-download-announcement-attachment-docx",
      originalButton: "button-download-announcement-attachment-",
      requiredFragments: [
        "api/announcements/attachments/${att.id}/file",
        "localStorage.getItem(TOKEN_KEY)",
        "Authorization: `Bearer ${token}`",
      ],
    },
    {
      surface: "document forms",
      file: "../pages/formularios.tsx",
      docxButton: "button-download-submission-docx",
      originalButton: "downloadSubmissionFile(value.id, fileName)",
      requiredFragments: [
        "api/document-forms/submission-values/${value.id}/file",
        "localStorage.getItem(TOKEN_KEY)",
        "Authorization: `Bearer ${token}`",
      ],
    },
    {
      surface: "chat",
      file: "../pages/chat.tsx",
      docxButton: "button-download-chat-attachment-docx",
      originalButton: "download={message.attachmentName",
      requiredFragments: [
        "disabled={!blobUrl}",
        "fetch(blobUrl)",
        "El archivo todavía no está disponible",
      ],
    },
    {
      surface: "coordinator email",
      file: "../components/coordinator-mail/coordinator-mail.tsx",
      docxButton: "button-download-mail-attachment-docx",
      originalButton: "button-download-attachment-",
      requiredFragments: [
        'file.status === "ready" && isHtmlDocumentName(file.fileName)',
        "api/coordinator-mail/attachments/${file.id}",
        'credentials: "include"',
        "Authorization: `Bearer ${token}`",
      ],
    },
  ] as const;

  it.each(cases)("keeps the protected HTML DOCX and original download wired for $surface", ({
    file,
    docxButton,
    originalButton,
    requiredFragments,
  }) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    expect(source).toContain("HtmlDocxDownloadButton");
    expect(source).toContain("isHtmlDocumentName");
    expect(source).toContain(docxButton);
    expect(source).toContain(originalButton);
    for (const fragment of requiredFragments) {
      expect(source).toContain(fragment);
    }
  });
});
