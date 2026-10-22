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
  vi.restoreAllMocks();
});

async function getDocxFiles(html: string, fileName = "material.html") {
  const blob = await createHtmlDocx(html, fileName);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

describe("createHtmlDocx", () => {
  const webpBytes = Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  ]);
  const webpDataUri = `data:image/webp;base64,${btoa(String.fromCharCode(...webpBytes))}`;
  const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  function mockWebpRasterization() {
    const drawImage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 1200, height: 800, close })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([pngBytes], { type: "image/png" }));
    });
    return { drawImage, close };
  }

  function docxMediaFiles(zip: JSZip) {
    return Object.keys(zip.files).filter((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  }

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

  it("converts embedded WebP images to PNG in the DOCX", async () => {
    const { drawImage, close } = mockWebpRasterization();
    const zip = await getDocxFiles(`<p>Before<img src="${webpDataUri}" alt="WebP embebido">After</p>`);
    const mediaFiles = docxMediaFiles(zip);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(mediaFiles).toHaveLength(1);
    expect(mediaFiles[0]).toMatch(/\.png$/);
    expect(new Uint8Array(await zip.file(mediaFiles[0])!.async("arraybuffer"))).toEqual(pngBytes);
    expect(documentXml).toContain("WebP embebido");
    expect(documentXml).toContain("Before");
    expect(documentXml).toContain("After");
    expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 600, 400);
    expect(close).toHaveBeenCalledOnce();
  });

  it("converts same-origin WebP responses and rejects external or SVG images", async () => {
    mockWebpRasterization();
    const fetchMock = vi.fn(async () => {
      const response = new Response(webpBytes, { headers: { "content-type": "image/webp" } });
      Object.defineProperty(response, "url", { value: `${window.location.origin}/local.webp` });
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const zip = await getDocxFiles(`
      <img src="/local.webp" alt="WebP local">
      <img src="https://images.example.test/external.webp" alt="Imagen externa">
      <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="SVG rechazado">
    `);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(docxMediaFiles(zip)).toHaveLength(1);
    expect(docxMediaFiles(zip)[0]).toMatch(/\.png$/);
    expect(documentXml).toContain("WebP local");
    expect(documentXml).toContain("Imagen externa");
    expect(documentXml).toContain("SVG rechazado");
  });

  it("keeps WebP alt text and continues when decoding fails", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("No se pudo decodificar");
    }));
    const zip = await getDocxFiles(`<p>Texto legible<img src="${webpDataUri}" alt="Descripción alternativa">El final sigue</p>`);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(documentXml).toContain("Texto legible");
    expect(documentXml).toContain("Descripción alternativa");
    expect(documentXml).toContain("El final sigue");
    expect(docxMediaFiles(zip)).toHaveLength(0);
  });

  it("keeps the alt text when a WebP fails signature validation or exceeds the download limit", async () => {
    const invalidWebp = Uint8Array.from(webpBytes);
    invalidWebp[0] = 0;
    const invalidDataUri = `data:image/webp;base64,${btoa(String.fromCharCode(...invalidWebp))}`;
    const oversizedResponse = new Response(webpBytes, {
      headers: { "content-type": "image/webp", "content-length": String(5 * 1024 * 1024 + 1) },
    });
    Object.defineProperty(oversizedResponse, "url", { value: `${window.location.origin}/oversized.webp` });
    const fetchMock = vi.fn(async () => oversizedResponse);
    vi.stubGlobal("fetch", fetchMock);
    const bitmapDecoder = vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() }));
    vi.stubGlobal("createImageBitmap", bitmapDecoder);

    const zip = await getDocxFiles(`
      <img src="${invalidDataUri}" alt="WebP inválido">
      <img src="/oversized.webp" alt="WebP demasiado grande">
    `);
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(bitmapDecoder).not.toHaveBeenCalled();
    expect(documentXml).toContain("WebP inválido");
    expect(documentXml).toContain("WebP demasiado grande");
    expect(docxMediaFiles(zip)).toHaveLength(0);
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

  it("applies allowlisted styles from same-origin linked stylesheets", async () => {
    const requestHeaders = { Authorization: "Bearer test-token" };
    const fetchMock = vi.fn(async () => new Response(
      ".linked { color: #123456; background-color: rgb(171, 205, 239); font-weight: 700; text-align: center; position: fixed; }",
      { headers: { "content-type": "text/css; charset=utf-8" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await createHtmlDocx(
      '<html><head><link rel="stylesheet" href="../styles/document.css"></head><body><p class="linked">Styled by linked CSS</p></body></html>',
      "linked.html",
      `${window.location.origin}/files/case/document.html`,
      requestHeaders,
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/files/styles/document.css`,
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
        headers: requestHeaders,
      }),
    );
    expect(documentXml).toContain("Styled by linked CSS");
    expect(documentXml).toContain("w:val=\"123456\"");
    expect(documentXml).toContain("w:fill=\"ABCDEF\"");
    expect(documentXml).toContain("<w:b/>");
    expect(documentXml).toContain("<w:jc w:val=\"center\"/>");
    expect(documentXml).not.toContain("position");
  });

  it("does not fetch third-party stylesheets and skips failed same-origin stylesheets", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("stylesheet unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);

    const blob = await createHtmlDocx(`
      <link rel="stylesheet" href="https://styles.example.test/external.css">
      <link rel="stylesheet" href="/missing.css">
      <p>DOCX still downloads</p>
    `, "offline-styles.html", `${window.location.origin}/files/document.html`);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")!.async("string");

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(`${window.location.origin}/missing.css`);
    expect(documentXml).toContain("DOCX still downloads");
  });

  it("ignores linked stylesheets when the HTML base URL is cross-origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const blob = await createHtmlDocx(
      '<link rel="stylesheet" href="/private.css"><p>Safe fallback</p>',
      "external-base.html",
      "https://outside.example.test/document.html",
    );

    expect(fetchMock).not.toHaveBeenCalled();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const documentXml = await zip.file("word/document.xml")!.async("string");
    expect(documentXml).toContain("Safe fallback");
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
