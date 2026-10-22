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

export type MinutesDocxContext = {
  eventName?: string;
  eventStartAt?: string | null;
  eventLocation?: string | null;
};

function inlineRuns(text: string, base: { color?: string; italics?: boolean } = {}): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g);
  return parts.filter(Boolean).map((part) => {
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return new TextRun({ ...base, text: part.slice(2, -2), bold: true, font: "Aptos" });
    }
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) {
      return new TextRun({ ...base, text: part.slice(1, -1), italics: true, font: "Aptos" });
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return new TextRun({ ...base, text: part.slice(1, -1), font: "Consolas", color: "475569" });
    }
    return new TextRun({ ...base, text: part.replace(/\\\|/g, "|"), font: "Aptos" });
  });
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableRule(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

function documentTable(headers: string[], rows: string[][]): Table {
  const border = { style: "single" as const, size: 1, color: "CBD5E1" };
  const makeCell = (text: string, header: boolean, columnWidth: number) => new TableCell({
    width: { size: columnWidth, type: WidthType.DXA },
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    verticalAlign: VerticalAlign.TOP,
    shading: header ? { fill: "EAF0F6", type: ShadingType.CLEAR } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph({
      spacing: { before: 0, after: 0, line: 260 },
      children: inlineRuns(text),
    })],
  });
  const count = Math.max(headers.length, 1);
  const width = Math.floor(9360 / count);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: headers.map(() => width),
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((cell) => makeCell(cell, true, width)) }),
      ...rows.map((row) => new TableRow({
        children: headers.map((_, index) => makeCell(row[index] ?? "", false, width)),
      })),
    ],
  });
}

function markdownBlocks(text: string): Array<Paragraph | Table> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<Paragraph | Table> = [];
  let list: Array<{ text: string; ordered: boolean }> = [];
  const flushList = () => {
    for (const [index, item] of list.entries()) {
      blocks.push(new Paragraph({
        indent: { left: 420, hanging: 240 },
        spacing: { before: 0, after: 90, line: 300 },
        children: [
          new TextRun({
            text: item.ordered ? `${index + 1}. ` : "• ",
            font: "Aptos",
            color: "1D4F91",
          }),
          ...inlineRuns(item.text),
        ],
      }));
    }
    list = [];
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trimEnd();
    if (index + 1 < lines.length && line.includes("|") && isTableRule(lines[index + 1])) {
      flushList();
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index++;
      }
      index--;
      blocks.push(documentTable(headers, rows));
      blocks.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    const listItem = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (listItem) {
      list.push({ text: listItem[3], ordered: !!listItem[2] });
      continue;
    }
    flushList();

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level === 1 ? 30 : level === 2 ? 26 : 22;
      blocks.push(new Paragraph({
        keepNext: true,
        spacing: { before: level === 1 ? 360 : 260, after: 120 },
        children: [new TextRun({
          text: heading[2],
          bold: true,
          font: "Aptos Display",
          size,
          color: level === 3 ? "475569" : "17365D",
        })],
      }));
    } else if (/^\s*>\s?/.test(line)) {
      blocks.push(new Paragraph({
        indent: { left: 360 },
        spacing: { before: 80, after: 120, line: 300 },
        children: inlineRuns(line.replace(/^\s*>\s?/, ""), { italics: true, color: "475569" }),
      }));
    } else if (/^\s*([-*_]\s*){3,}$/.test(line)) {
      blocks.push(new Paragraph({
        border: { bottom: { style: "single", size: 4, color: "CBD5E1", space: 4 } },
        spacing: { after: 160 },
        children: [new TextRun({ text: " " })],
      }));
    } else if (line.trim()) {
      blocks.push(new Paragraph({
        spacing: { before: 0, after: 130, line: 310 },
        children: inlineRuns(line),
      }));
    }
  }
  flushList();
  return blocks;
}

export async function createMinutesDocx(text: string, context: MinutesDocxContext): Promise<Blob> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [new TextRun({
        text: "COORDINACIÓN EDUCATIVA",
        bold: true,
        allCaps: true,
        font: "Aptos",
        size: 18,
        color: "1D4F91",
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      border: { bottom: { style: "single", size: 12, color: "1D4F91", space: 10 } },
      children: [new TextRun({
        text: "ACTA DE REUNIÓN",
        bold: true,
        font: "Aptos Display",
        size: 34,
        color: "172B4D",
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
      children: [new TextRun({
        text: "REUNIÓN DE COORDINACIÓN",
        font: "Aptos",
        size: 18,
        color: "64748B",
      })],
    }),
  ];

  const metadata = [
    ...(context.eventName ? [["Evento", context.eventName]] : []),
    ...(context.eventStartAt ? [["Fecha y hora", new Date(context.eventStartAt).toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" })]] : []),
    ...(context.eventLocation ? [["Lugar", context.eventLocation]] : []),
  ];
  if (metadata.length) {
    for (const [label, value] of metadata) {
      children.push(new Paragraph({
        spacing: { before: 0, after: 75 },
        children: [
          new TextRun({ text: `${label}: `, bold: true, font: "Aptos", size: 20, color: "475569" }),
          new TextRun({ text: value, font: "Aptos", size: 20, color: "334155" }),
        ],
      }));
    }
    children.push(new Paragraph({
      spacing: { before: 0, after: 180 },
      border: { bottom: { style: "single", size: 4, color: "CBD5E1", space: 4 } },
      children: [new TextRun({ text: " " })],
    }));
  }

  children.push(...markdownBlocks(text));
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 480 },
    border: { top: { style: "single", size: 4, color: "CBD5E1", space: 6 } },
    children: [new TextRun({
      text: "Documento de trabajo · Requiere revisión y aprobación de la coordinación",
      italics: true,
      font: "Aptos",
      size: 16,
      color: "64748B",
    })],
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 900, right: 1080, bottom: 900, left: 1080 } } },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
