import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export type ExportSheet = {
  name: string;
  columns: string[];
  rows: (string | number)[][];
};

// Export one or more tabular datasets to a multi-section PDF.
export function exportTablesPdf(
  title: string,
  sections: ExportSheet[],
  filename: string,
): void {
  const doc = new jsPDF();
  const margin = 14;
  doc.setFontSize(15);
  doc.text(title, margin, 18);
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(new Date().toLocaleDateString("es-ES"), margin, 24);
  doc.setTextColor(0);

  let cursorY = 30;
  for (const section of sections) {
    doc.setFontSize(12);
    doc.text(section.name, margin, cursorY);
    autoTable(doc, {
      startY: cursorY + 3,
      head: [section.columns],
      body: section.rows.map((r) => r.map(String)),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235] },
    });
    const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable;
    cursorY = (lastTable?.finalY ?? cursorY) + 12;
  }
  doc.save(filename);
}

// Export one or more tabular datasets to an Excel workbook (one sheet each).
export function exportSheetsXlsx(
  sheets: ExportSheet[],
  filename: string,
): void {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([sheet.columns, ...sheet.rows]);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

// Export a long-form text document (e.g. an annual report) to a paginated PDF.
export function exportTextPdf(
  title: string,
  body: string,
  filename: string,
): void {
  const doc = new jsPDF();
  const margin = 14;
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const lineHeight = 5;

  doc.setFontSize(15);
  let y = 20;
  const titleLines = doc.splitTextToSize(title, maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 7 + 4;

  doc.setFontSize(10);
  const lines = doc.splitTextToSize(body, maxWidth);
  for (const line of lines) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin + 6;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
  doc.save(filename);
}
