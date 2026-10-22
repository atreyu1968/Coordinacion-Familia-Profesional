import {
  AlignmentType,
  Document,
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
};

type DocxBlock = Paragraph | Table;

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED",
  "SVG", "CANVAS", "META", "LINK", "HEAD", "NAV", "FORM", "BUTTON",
  "INPUT", "SELECT", "OPTION", "TEXTAREA", "LABEL", "VIDEO", "AUDIO", "SOURCE",
]);
const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "DL", "FIELDSET",
  "FIGCAPTION", "FIGURE", "FOOTER", "HEADER", "MAIN",
  "P", "PRE", "SECTION",
]);

function inlineRuns(node: Node, style: TextStyle = {}): TextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return text.trim() ? [new TextRun({ text, font: "Aptos", ...style })] : [];
  }
  if (!(node instanceof Element)) return [];
  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag) || ["UL", "OL", "TABLE"].includes(tag)) return [];
  if (tag === "BR") return [new TextRun({ break: 1 })];
  if (tag === "IMG") {
    const alt = node.getAttribute("alt")?.trim();
    return alt ? [new TextRun({ text: `[${alt}]`, italics: true, color: "64748B", ...style })] : [];
  }

  const next: TextStyle = { ...style };
  if (["B", "STRONG"].includes(tag)) next.bold = true;
  if (["I", "EM", "CITE", "DFN"].includes(tag)) next.italics = true;
  if (["CODE", "KBD", "SAMP", "TT"].includes(tag)) next.font = "Consolas";
  if (tag === "U") next.underline = { type: "single" };
  if (tag === "A") {
    next.color = "0563C1";
    next.underline = { type: "single" };
  }
  return Array.from(node.childNodes).flatMap((child) => inlineRuns(child, next));
}

function htmlTable(element: Element): Table | null {
  const sourceRows = Array.from(element.querySelectorAll("tr"))
    .filter((row) => row.closest("table") === element)
    .map((row) => ({
      header: Array.from(row.children).some((cell) => cell.tagName.toUpperCase() === "TH"),
      cells: Array.from(row.children)
        .filter((cell) => ["TD", "TH"].includes(cell.tagName.toUpperCase()))
        .map((cell) => inlineRuns(cell)),
    }))
    .filter((row) => row.cells.length > 0);
  if (!sourceRows.length) return null;

  const columnCount = Math.max(...sourceRows.map((row) => row.cells.length));
  const cellWidth = Math.floor(9360 / columnCount);
  const border = { style: "single" as const, size: 1, color: "CBD5E1" };
  const rows = sourceRows.map((row, rowIndex) => {
    const isHeader = row.header || (rowIndex === 0 && sourceRows.length > 1);
    return new TableRow({
      tableHeader: isHeader,
      children: Array.from({ length: columnCount }, (_, columnIndex) => new TableCell({
        width: { size: cellWidth, type: WidthType.DXA },
        margins: { top: 90, bottom: 90, left: 110, right: 110 },
        verticalAlign: VerticalAlign.TOP,
        shading: isHeader ? { fill: "EAF0F6", type: ShadingType.CLEAR } : undefined,
        borders: { top: border, bottom: border, left: border, right: border },
        children: [new Paragraph({
          spacing: { before: 0, after: 0, line: 260 },
          children: row.cells[columnIndex]?.length ? row.cells[columnIndex] : [new TextRun({ text: "" })],
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

function listBlocks(list: Element, depth = 0): Paragraph[] {
  const ordered = list.tagName.toUpperCase() === "OL";
  const items = Array.from(list.children).filter((child) => child.tagName.toUpperCase() === "LI");
  return items.flatMap((item, index) => {
    const nestedLists = Array.from(item.children).filter((child) => ["UL", "OL"].includes(child.tagName.toUpperCase()));
    const paragraph = new Paragraph({
      indent: { left: 420 + depth * 360, hanging: 240 },
      spacing: { before: 0, after: 90, line: 300 },
      children: [
        new TextRun({ text: ordered ? `${index + 1}. ` : "• ", color: "1D4F91", font: "Aptos" }),
        ...Array.from(item.childNodes).flatMap((child) => inlineRuns(child)),
      ],
    });
    return [
      paragraph,
      ...nestedLists.flatMap((nested) => listBlocks(nested, depth + 1)),
    ];
  });
}

function htmlBlocks(element: Element): DocxBlock[] {
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
      blocks.push(new Paragraph({
        keepNext: true,
        spacing: { before: level === 1 ? 320 : 220, after: 120 },
        children: [new TextRun({
          text: node.textContent?.trim() ?? "",
          bold: true,
          font: "Aptos Display",
          size: Math.max(20, 32 - (level - 1) * 2),
          color: level < 3 ? "17365D" : "475569",
        })],
      }));
      continue;
    }
    if (tag === "UL" || tag === "OL") {
      blocks.push(...listBlocks(node));
      continue;
    }
    if (tag === "TABLE") {
      const table = htmlTable(node);
      if (table) {
        blocks.push(table, new Paragraph({ spacing: { after: 120 } }));
      }
      continue;
    }
    if (tag === "HR") {
      blocks.push(new Paragraph({
        border: { bottom: { style: "single", size: 4, color: "CBD5E1", space: 4 } },
        spacing: { after: 160 },
        children: [new TextRun({ text: " " })],
      }));
      continue;
    }
    if (tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE" || tag === "ADDRESS" || tag === "FIGCAPTION" || tag === "DT" || tag === "DD") {
      blocks.push(new Paragraph({
        indent: tag === "BLOCKQUOTE" ? { left: 360 } : undefined,
        spacing: { before: 0, after: 130, line: 310 },
        children: inlineRuns(node, tag === "BLOCKQUOTE" ? { italics: true, color: "475569" } : tag === "PRE" ? { font: "Consolas" } : {}),
      }));
      continue;
    }

    if (Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName.toUpperCase()) || ["UL", "OL", "TABLE"].includes(child.tagName.toUpperCase()))) {
      blocks.push(...htmlBlocks(node));
    } else {
      const runs = inlineRuns(node);
      if (runs.length) blocks.push(new Paragraph({ spacing: { after: 130, line: 310 }, children: runs }));
    }
  }
  return blocks;
}

export async function createHtmlDocx(html: string, fileName: string): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const title = fileName.replace(/\.(?:html|htm)$/i, "") || parsed.title || "Documento";
  const children: DocxBlock[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
      border: { bottom: { style: "single", size: 8, color: "1D4F91", space: 8 } },
      children: [new TextRun({ text: title, bold: true, font: "Aptos Display", size: 32, color: "172B4D" })],
    }),
    ...htmlBlocks(parsed.body),
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
