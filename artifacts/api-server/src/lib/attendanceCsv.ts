export type CsvAttendanceRow = {
  line: number; fullName: string; email: string;
  status: "ready" | "duplicate" | "error"; message: string | null;
};
export const normalizedEmail = (value: string): string => value.trim().toLowerCase();

/** Bounded RFC4180-style comma/semicolon parser, with quoted multiline fields. */
export function parseAttendanceCsv(input: string, existing = new Set<string>()) {
  if (Buffer.byteLength(input, "utf8") > 250000) throw new Error("El CSV supera 250 KB.");
  const text = input.replace(/^\uFEFF/, "");
  const headerLine = text.split(/\r?\n/, 1)[0] ?? "";
  // Count delimiters outside quoted fields; commas inside names do not decide the dialect.
  let quote = false; let commas = 0; let semicolons = 0;
  for (const ch of headerLine) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === ",") commas++;
    if (!quote && ch === ";") semicolons++;
  }
  const delimiter = semicolons > commas ? ";" : ",";
  const records: { line: number; values: string[] }[] = [];
  let values: string[] = []; let value = ""; let quoted = false; let closed = false;
  let line = 1; let recordLine = 1;
  const field = () => { values.push(value); value = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { value += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else { value += ch; if (ch === "\n") line++; }
    } else if (ch === '"' && value.length === 0 && !closed) quoted = true;
    else if (ch === delimiter) field();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      field();
      if (values.some((v) => v.trim())) records.push({ line: recordLine, values });
      values = []; line++; recordLine = line;
    } else {
      if (closed && ch.trim()) throw new Error(`CSV mal formado en la línea ${line}.`);
      value += ch;
    }
  }
  if (quoted) throw new Error("El CSV contiene comillas sin cerrar.");
  field();
  if (values.some((v) => v.trim())) records.push({ line: recordLine, values });
  if (records.length < 2) throw new Error("Incluye una cabecera nombre,email y al menos un asistente.");
  if (records.length > 501) throw new Error("Se admiten como máximo 500 asistentes por CSV.");
  const header = records.shift()!.values.map((v) => v.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[\s_]+/g, ""));
  const ni = header.findIndex((v) => ["nombre", "nombrecompleto", "nombreyapellidos", "fullname"].includes(v));
  const ei = header.findIndex((v) => ["email", "correo", "correoelectronico"].includes(v));
  const si = header.indexOf("apellidos");
  if (ni < 0 || ei < 0 || ni === ei) throw new Error("El CSV debe tener las columnas nombre y email (o correo).");
  const seen = new Set(existing);
  const rows: CsvAttendanceRow[] = records.map((r) => {
    const fullName = [r.values[ni], si >= 0 ? r.values[si] : ""].filter(Boolean).join(" ").trim().normalize("NFC");
    const email = normalizedEmail(r.values[ei] ?? "");
    const row: CsvAttendanceRow = { line: r.line, fullName, email, status: "ready", message: null };
    if (r.values.length !== header.length) { row.status = "error"; row.message = "Número de columnas incorrecto."; }
    else if (fullName.length < 2 || fullName.length > 200 || /[\u0000-\u001f]/.test(fullName)) { row.status = "error"; row.message = "Nombre no válido (2–200 caracteres, sin saltos de línea)."; }
    else if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { row.status = "error"; row.message = "Correo electrónico no válido."; }
    else if (seen.has(email)) { row.status = "duplicate"; row.message = "Correo ya incluido en este evento o repetido en el CSV."; }
    if (row.status !== "error") seen.add(email);
    return row;
  });
  return {
    rows, errors: rows.filter((r) => r.status === "error").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    ready: rows.filter((r) => r.status === "ready").length,
  };
}
