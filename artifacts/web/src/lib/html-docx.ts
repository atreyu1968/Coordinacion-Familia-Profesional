import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

type TextStyle = {
  bold?: boolean;
  italics?: boolean;
  underline?: { type?: "single"; color?: string };
  color?: string;
  font?: string;
  size?: number;
};
type DocxBlock = Paragraph | Table;

type CssProperties = Record<string, string>;
type InlineContent = TextRun | ExternalHyperlink | ImageRun;

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED",
  "SVG", "CANVAS", "META", "LINK", "HEAD", "NAV", "FORM", "BUTTON",
  "INPUT", "SELECT", "OPTION", "TEXTAREA", "LABEL", "VIDEO", "AUDIO", "SOURCE",
  "DETAILS", "SUMMARY", "DIALOG", "DATALIST", "OUTPUT", "METER", "PROGRESS", "APPLET",
]);
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "HEADER", "MAIN",
  "P", "PRE", "SECTION",
]);

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
async function inlineRuns(
  node: Node,
  style: TextStyle = {},
  rules: CssRule[] = [],
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
): Promise<InlineContent[]> {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.trim() ? [new TextRun({ text, font: "Aptos", ...style })] : [];
  }
  if (!(node instanceof Element)) return [];
  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag) || ["UL", "OL", "TABLE"].includes(tag)) return [];
  if (tag === "BR") return [new TextRun({ break: 1 })];
  const next: TextStyle = { ...style };
  Object.assign(next, inheritedTextStyle(node, rules));
  if (["B", "STRONG"].includes(tag)) next.bold = true;
  if (["I", "EM", "CITE", "DFN"].includes(tag)) next.italics = true;
  if (["CODE", "KBD", "SAMP", "TT"].includes(tag)) next.font = "Consolas";
  if (tag === "U") next.underline = { type: "single" };
  if (tag === "A") {
    next.color = next.color ?? "0563C1";
    next.underline = { type: "single" };
    const children = (await Promise.all(
      Array.from(node.childNodes, (child) => inlineRuns(child, next, rules, baseUrl, requestHeaders)),
    )).flat();
    const href = node.getAttribute("href")?.trim();
    if (href) {
      try {
        const url = new URL(href);
        if (["http:", "https:", "mailto:"].includes(url.protocol)) {
          return [new ExternalHyperlink({ link: href, children })];
        }
      } catch {
        // Keep non-absolute or malformed links as styled text only.
      }
    }
    return children;
  }
  if (tag === "IMG") return [await imageRun(node, rules, baseUrl, requestHeaders)];
  return (await Promise.all(Array.from(node.childNodes, (child) => inlineRuns(child, next, rules, baseUrl, requestHeaders)))).flat();
}

async function htmlTable(
  element: Element,
  rules: CssRule[],
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
): Promise<Table | null> {
  const sourceRows = Array.from(element.querySelectorAll("tr"))
    .filter((row) => row.closest("table") === element)
    .map(async (row) => ({
      header: Array.from(row.children).some((cell) => cell.tagName.toUpperCase() === "TH"),
      cells: await Promise.all(Array.from(row.children)
        .filter((cell) => ["TD", "TH"].includes(cell.tagName.toUpperCase()))
        .map(async (cell) => ({
          children: await inlineRuns(cell, {}, rules, baseUrl, requestHeaders),
          alignment: paragraphAlignment(cell, rules),
          shading: paragraphShading(cell, rules),
        }))),
    }));
  const resolvedRows = (await Promise.all(sourceRows)).filter((row) => row.cells.length > 0);
  if (!resolvedRows.length) return null;

  const columnCount = Math.max(...resolvedRows.map((row) => row.cells.length));
  const cellWidth = Math.floor(9360 / columnCount);
  const border = { style: "single" as const, size: 1, color: "CBD5E1" };
  const rows = resolvedRows.map((row, rowIndex) => {
    const isHeader = row.header || (rowIndex === 0 && resolvedRows.length > 1);
    return new TableRow({
      tableHeader: isHeader,
      children: Array.from({ length: columnCount }, (_, columnIndex) => new TableCell({
        width: { size: cellWidth, type: WidthType.DXA },
        margins: { top: 90, bottom: 90, left: 110, right: 110 },
        verticalAlign: VerticalAlign.TOP,
        shading: row.cells[columnIndex]?.shading ?? (isHeader ? { fill: "EAF0F6", type: ShadingType.CLEAR } : undefined),
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({
          alignment: row.cells[columnIndex]?.alignment,
          shading: row.cells[columnIndex]?.shading,
          spacing: { before: 0, after: 0, line: 260 },
          children: row.cells[columnIndex]?.children.length ? row.cells[columnIndex].children : [new TextRun({ text: "" })],
        })],
      })),
    });
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: Array.from({ length: columnCount }, () => cellWidth),
    rows,
  });
}

async function listBlocks(
  list: Element,
  rules: CssRule[],
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
  depth = 0,
): Promise<Paragraph[]> {
  const ordered = list.tagName.toUpperCase() === "OL";
  const items = Array.from(list.children).filter((child) => child.tagName.toUpperCase() === "LI");
  const result = await Promise.all(items.map(async (item, index) => {
    const nestedLists = Array.from(item.children).filter((child) => ["UL", "OL"].includes(child.tagName.toUpperCase()));
    const paragraph = new Paragraph({
      indent: { left: 420 + depth * 360, hanging: 240 },
      alignment: paragraphAlignment(item, rules),
      spacing: { before: 0, after: 90, line: 300 },
      children: [
        new TextRun({ text: ordered ? `${index + 1}. ` : "• ", color: "1D4F91", font: "Aptos" }),
        ...(await Promise.all(Array.from(item.childNodes, (child) => inlineRuns(child, {}, rules, baseUrl, requestHeaders)))).flat(),
      ],
      shading: paragraphShading(item, rules),
    });
    return [
      paragraph,
      ...(await Promise.all(nestedLists.map((nested) => listBlocks(nested, rules, baseUrl, requestHeaders, depth + 1)))).flat(),
    ];
  }));
  return result.flat();
}

async function htmlBlocks(
  element: Element,
  rules: CssRule[],
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
): Promise<DocxBlock[]> {
  const blocks: DocxBlock[] = [];
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) blocks.push(new Paragraph({ children: [new TextRun({ text, font: "Aptos" })] }));
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag) || node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") continue;

    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      const cssText = inheritedTextStyle(node, rules);
      blocks.push(new Paragraph({
        keepNext: true,
        alignment: paragraphAlignment(node, rules),
        shading: paragraphShading(node, rules),
        spacing: { before: level === 1 ? 320 : 220, after: 120 },
        children: [new TextRun({
          text: node.textContent?.trim() ?? "",
          bold: true,
          font: cssText.font ?? "Aptos Display",
          size: cssText.size ?? Math.max(20, 32 - (level - 1) * 2),
          color: cssText.color ?? (level < 3 ? "17365D" : "475569"),
          italics: cssText.italics,
          underline: cssText.underline,
        })],
      }));
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      blocks.push(...await listBlocks(node, rules, baseUrl, requestHeaders));
      continue;
    }
    if (tag === "TABLE") {
      const table = await htmlTable(node, rules, baseUrl, requestHeaders);
      if (table) {
        blocks.push(table, new Paragraph({ spacing: { after: 120 } }));
      }
      continue;
    }
    if (tag === "HR") {
      blocks.push(new Paragraph({
        alignment: paragraphAlignment(node, rules),
        shading: paragraphShading(node, rules),
        border: { bottom: { style: "single", size: 4, color: "CBD5E1", space: 4 } },
        spacing: { after: 160 },
        children: [new TextRun({ text: " " })],
      }));
      continue;
    }
    if (tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE" || tag === "ADDRESS" || tag === "FIGCAPTION" || tag === "DT" || tag === "DD") {
      blocks.push(new Paragraph({
        indent: tag === "BLOCKQUOTE" ? { left: 360 } : undefined,
        alignment: paragraphAlignment(node, rules),
        shading: paragraphShading(node, rules),
        spacing: { before: 0, after: 130, line: 310 },
        children: await inlineRuns(node, tag === "BLOCKQUOTE" ? { italics: true, color: "475569" } : tag === "PRE" ? { font: "Consolas" } : {}, rules, baseUrl, requestHeaders),
      }));
      continue;
    }

    if (Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName.toUpperCase()) || ["UL", "OL", "TABLE"].includes(child.tagName.toUpperCase()))) {
      blocks.push(...await htmlBlocks(node, rules, baseUrl, requestHeaders));
    } else {
      const runs = await inlineRuns(node, {}, rules, baseUrl, requestHeaders);
      if (runs.length) blocks.push(new Paragraph({
        alignment: paragraphAlignment(node, rules),
        shading: paragraphShading(node, rules),
        spacing: { after: 130, line: 310 },
        children: runs,
      }));
    }
  }
  return blocks;
}

export async function createHtmlDocx(
  html: string,
  fileName: string,
  imageBaseUrl?: string,
  imageHeaders?: Record<string, string>,
): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const rules = await stylesheetRules(parsed, imageBaseUrl, imageHeaders);
  const title = fileName.replace(/\.(?:html|htm)$/i, "") || parsed.title || "Documento";
  const children: DocxBlock[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      border: { bottom: { style: "single", size: 8, color: "1D4F91", space: 8 } },
      children: [new TextRun({ text: title, bold: true, font: "Aptos Display", size: 32, color: "172B4D" })],
    }),
    ...await htmlBlocks(parsed.body, rules, imageBaseUrl, imageHeaders),
  ];
  const doc = new Document({
    title,
    sections: [{
      properties: { page: { margin: { top: 900, right: 1080, bottom: 900, left: 1080 } } },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

const MAX_DOCX_IMAGE_WIDTH = 600;

const MAX_DOCX_IMAGE_HEIGHT = 750;

const MAX_STYLESHEET_BYTES = 256 * 1024;
const MAX_TOTAL_STYLESHEET_BYTES = 512 * 1024;
const MAX_STYLESHEETS = 10;

async function stylesheetRules(
  root: ParentNode,
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
): Promise<CssRule[]> {
  const rules: CssRule[] = [];
  const origin = window.location.origin;
  let documentUrl: URL;
  let allowLinkedStylesheets = true;
  try {
    documentUrl = new URL(baseUrl ?? window.location.href, window.location.href);
    if (documentUrl.origin !== origin || !["http:", "https:"].includes(documentUrl.protocol)) {
      allowLinkedStylesheets = false;
    }
  } catch {
    documentUrl = new URL(window.location.href);
    allowLinkedStylesheets = Boolean(!baseUrl);
  }

  let totalBytes = 0;
  let stylesheetCount = 0;
  for (const sheet of Array.from(root.querySelectorAll("style, link[rel][href]"))) {
    if (rules.length >= 100) break;
    if (sheet.tagName.toUpperCase() === "STYLE") {
      addStylesheetRules(rules, sheet.textContent ?? "");
      continue;
    }
    if (
      !allowLinkedStylesheets
      || sheet.tagName.toUpperCase() !== "LINK"
      || !sheet.getAttribute("rel")?.split(/\s+/).some((rel) => rel.toLowerCase() === "stylesheet")
      || !sheet.hasAttribute("href")
    ) continue;
    if (stylesheetCount >= MAX_STYLESHEETS || totalBytes >= MAX_TOTAL_STYLESHEET_BYTES) continue;
    stylesheetCount += 1;
    const href = sheet.getAttribute("href")?.trim();
    if (!href) continue;
    try {
      const url = new URL(href, documentUrl);
      if (
        !["http:", "https:"].includes(url.protocol)
        || url.origin !== origin
        || url.username
        || url.password
      ) continue;
      const response = await fetch(url.href, {
        credentials: "same-origin",
        redirect: "error",
        headers: requestHeaders,
      });
      if (!response.ok || (response.url && new URL(response.url).origin !== origin)) continue;
      if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "text/css") continue;
      const bytes = await readBoundedResponse(response, Math.min(
        MAX_STYLESHEET_BYTES,
        MAX_TOTAL_STYLESHEET_BYTES - totalBytes,
      ));
      if (!bytes) continue;
      totalBytes += bytes.length;
      addStylesheetRules(rules, new TextDecoder().decode(bytes));
    } catch {
      // Missing, inaccessible, or malformed stylesheets must not block DOCX download.
    }
  }
  return rules.slice(0, 100);
}

function addStylesheetRules(rules: CssRule[], source: string): void {
  const css = source.slice(0, 100_000).replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (rules.length >= 100) break;
    const declarations = cssDeclarations(match[2]);
    if (!Object.keys(declarations).length) continue;
    for (const selector of match[1].split(",")) {
      const cleanSelector = selector.trim();
      if (cleanSelector && cleanSelector.length <= 200 && !cleanSelector.startsWith("@")) {
        rules.push({ selector: cleanSelector, declarations });
        if (rules.length >= 100) break;
      }
    }
  }
}

function alignment(value?: string): ParagraphAlignment | undefined {
  switch (value?.toLowerCase()) {
    case "left": return AlignmentType.LEFT;
    case "right": return AlignmentType.RIGHT;
    case "center": return AlignmentType.CENTER;
    case "justify": return AlignmentType.JUSTIFIED;
    default: return undefined;
  }
}

function imageType(bytes: Uint8Array): SourceImageType | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))) return "gif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return undefined;
}

function paragraphShading(element: Element, rules: CssRule[]) {
  const fill = safeColor(cssFor(element, rules)["background-color"]);
  return fill ? { fill, type: ShadingType.CLEAR } : undefined;
}

const NAMED_COLORS: Record<string, string> = {
  black: "000000", white: "FFFFFF", red: "FF0000", green: "008000",
  blue: "0000FF", navy: "000080", gray: "808080", grey: "808080",
  silver: "C0C0C0", maroon: "800000", purple: "800080", teal: "008080",
  olive: "808000", orange: "FFA500", yellow: "FFFF00",
};

function textStyleFromCss(css: CssProperties): TextStyle {
  const style: TextStyle = {};
  const color = safeColor(css.color);
  if (color) style.color = color;
  const family = css["font-family"]?.split(",")[0]?.trim().replace(/^["']|["']$/g, "");
  if (family && /^[\w -]{1,40}$/.test(family)) style.font = family;
  const size = css["font-size"]?.match(/^(\d+(?:\.\d+)?)(px|pt|em|rem|%)?$/i);
  if (size) {
    const amount = Number(size[1]);
    const unit = size[2]?.toLowerCase() ?? "px";
    const points = unit === "pt" ? amount : unit === "%" ? amount * 0.12 : unit === "em" || unit === "rem" ? amount * 12 : amount * 0.75;
    if (Number.isFinite(points)) style.size = Math.round(Math.max(6, Math.min(points, 72)) * 2);
  }
  if (/^(bold|bolder|[6-9]00)$/i.test(css["font-weight"] ?? "")) style.bold = true;
  if (/^(italic|oblique)$/i.test(css["font-style"] ?? "")) style.italics = true;
  if (/\bunderline\b/i.test(css["text-decoration"] ?? "")) style.underline = { type: "single" };
  return style;
}

function cssFor(element: Element, rules: CssRule[]): CssProperties {
  const result: CssProperties = {};
  for (const rule of rules) {
    try {
      if (element.matches(rule.selector)) Object.assign(result, rule.declarations);
    } catch {
      // Ignore unsupported or malformed selectors from the source document.
    }
  }
  Object.assign(result, cssDeclarations(element.getAttribute("style") ?? ""));
  return result;
}

type ImageType = "png" | "jpg" | "gif" | "bmp";
type SourceImageType = ImageType | "webp";

function inheritedTextStyle(element: Element, rules: CssRule[]): TextStyle {
  const ancestors: Element[] = [];
  let current: Element | null = element;
  while (current) {
    ancestors.unshift(current);
    current = current.parentElement;
  }
  return ancestors.reduce<TextStyle>((style, ancestor) => ({
    ...style,
    ...textStyleFromCss(cssFor(ancestor, rules)),
  }), {});
}

function imageDimensions(bytes: Uint8Array, type: ImageType): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "png" && bytes.length >= 24) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (type === "gif" && bytes.length >= 10) return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (type === "bmp" && bytes.length >= 26) return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  if (type === "jpg") {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const size = view.getUint16(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      }
      if (size < 2) break;
      offset += size + 2;
    }
  }
  return { width: 600, height: 400 };
}

function decodeDataImage(src: string): Uint8Array | null {
  const match = src.match(/^data:image\/(png|jpe?g|gif|bmp|webp)(?:;(base64|charset=[^,]+))?,(.*)$/is);
  if (!match || src.length > MAX_IMAGE_BYTES * 1.5) return null;
  try {
    const data = match[3].replace(/\s/g, "");
    if (match[2]?.toLowerCase() === "base64") {
      const raw = atob(data);
      if (raw.length > MAX_IMAGE_BYTES) return null;
      return Uint8Array.from(raw, (char) => char.charCodeAt(0));
    }
    const bytes = new TextEncoder().encode(decodeURIComponent(data));
    return bytes.length <= MAX_IMAGE_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

function safeColor(value?: string): string | undefined {
  if (!value) return undefined;
  const color = value.trim().toLowerCase();
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (hex) return hex.length === 3 ? [...hex].map((part) => part + part).join("").toUpperCase() : hex.toUpperCase();
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/);
  if (/^rgba\(/.test(color) && /,\s*0\s*\)$/.test(color)) return undefined;
  if (rgb && rgb.slice(1, 4).every((part) => Number(part) <= 255)) {
    return rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return NAMED_COLORS[color];
}

function cssDeclarations(source: string): CssProperties {
  const result: CssProperties = {};
  for (const declaration of source.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (SAFE_CSS_PROPERTIES.has(property) && value && !/[;{}]/.test(value)) result[property] = value;
  }
  return result;
}

function paragraphAlignment(element: Element, rules: CssRule[]): ParagraphAlignment | undefined {
  let current: Element | null = element;
  let found: ParagraphAlignment | undefined;
  while (current) {
    found = found ?? alignment(cssFor(current, rules)["text-align"]) ?? alignment(current.getAttribute("align") ?? undefined);
    current = current.parentElement;
  }
  return found ?? alignment(element.getAttribute("align") ?? undefined);
}

const SAFE_CSS_PROPERTIES = new Set([
  "color", "font-size", "font-family", "font-weight", "font-style",
  "text-decoration", "text-align", "background-color", "width", "height",
]);

type ParagraphAlignment = (typeof AlignmentType)[keyof typeof AlignmentType];

type ImageSource = { bytes: Uint8Array; type: ImageType };

async function readBoundedResponse(response: Response, maxBytes = MAX_IMAGE_BYTES): Promise<Uint8Array | null> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) return null;
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length <= maxBytes ? bytes : null;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function imageRun(
  element: Element,
  rules: CssRule[],
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
): Promise<ImageRun | TextRun> {
  const alt = element.getAttribute("alt")?.trim();
  const src = element.getAttribute("src")?.trim();
  if (!src) return new TextRun({ text: alt ? `[${alt}]` : "", italics: Boolean(alt), color: alt ? "64748B" : undefined });
  const image = await loadImage(src, baseUrl, requestHeaders);
  if (!image) return new TextRun({ text: alt ? `[${alt}]` : "", italics: Boolean(alt), color: alt ? "64748B" : undefined });
  const intrinsic = imageDimensions(image.bytes, image.type);
  const inlineCss = cssFor(element, rules);
  const styleWidth = inlineCss.width?.match(/^(\d+(?:\.\d+)?)px$/i);
  const styleHeight = inlineCss.height?.match(/^(\d+(?:\.\d+)?)px$/i);
  const attrWidth = Number(element.getAttribute("width"));
  const attrHeight = Number(element.getAttribute("height"));
  let width = styleWidth ? Number(styleWidth[1]) : Number.isFinite(attrWidth) && attrWidth > 0 ? attrWidth : intrinsic.width;
  let height = styleHeight ? Number(styleHeight[1]) : Number.isFinite(attrHeight) && attrHeight > 0 ? attrHeight : intrinsic.height;
  if (!styleHeight && !element.hasAttribute("height")) height = width * intrinsic.height / intrinsic.width;
  if (!styleWidth && !element.hasAttribute("width")) width = height * intrinsic.width / intrinsic.height;
  const scale = Math.min(1, MAX_DOCX_IMAGE_WIDTH / width, MAX_DOCX_IMAGE_HEIGHT / height);
  return new ImageRun({
    data: image.bytes,
    type: image.type,
    transformation: { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) },
    altText: { name: alt || "Imagen", description: alt || undefined, title: alt || undefined },
  });
}

type CssRule = { selector: string; declarations: CssProperties };

async function loadImage(
  src: string,
  baseUrl?: string,
  requestHeaders?: Record<string, string>,
): Promise<ImageSource | null> {
  let bytes: Uint8Array | null = null;
  if (/^data:/i.test(src)) {
    bytes = decodeDataImage(src);
  } else {
    try {
      const safeBaseUrl = baseUrl && /^https?:\/\//i.test(baseUrl) ? baseUrl : window.location.href;
      const resolved = new URL(src, safeBaseUrl);
      if (!["http:", "https:"].includes(resolved.protocol) || resolved.origin !== window.location.origin) return null;
      const response = await fetch(resolved.href, {
        credentials: "same-origin",
        redirect: "error",
        headers: requestHeaders,
      });
      if (!response.ok || new URL(response.url).origin !== window.location.origin) return null;
      const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
      if (!contentType || !/^image\/(png|jpeg|gif|bmp|webp)$/.test(contentType)) return null;
      bytes = await readBoundedResponse(response);
    } catch {
      return null;
    }
  }
  if (!bytes) return null;
  const type = imageType(bytes);
  if (!type) return null;
  let decoded: ImageBitmap | undefined;
  try {
    const imageBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(imageBuffer).set(bytes);
    decoded = await createImageBitmap(new Blob([imageBuffer]));
    const valid = decoded.width > 0 && decoded.height > 0 && decoded.width <= 50_000 && decoded.height <= 50_000;
    if (!valid) return null;
    if (type !== "webp") return { bytes, type };

    // DOCX does not support WebP. Rasterize it to PNG at the largest dimensions
    // that can be placed in this document, avoiding a full-size canvas allocation.
    const scale = Math.min(1, MAX_DOCX_IMAGE_WIDTH / decoded.width, MAX_DOCX_IMAGE_HEIGHT / decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png || png.size > MAX_IMAGE_BYTES) return null;
    const convertedBytes = new Uint8Array(await png.arrayBuffer());
    return imageType(convertedBytes) === "png" ? { bytes: convertedBytes, type: "png" } : null;
  } catch {
    return null;
  } finally {
    try {
      decoded?.close();
    } catch {
      // A cleanup error must not interrupt document conversion.
    }
  }
}
