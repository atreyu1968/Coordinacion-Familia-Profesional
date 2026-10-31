import type {
  ForumCurriculumInput,
  ForumCurriculumOutcome,
} from "@workspace/api-client-react";

export const CURRICULUM_FAMILY = "Administración y Gestión" as const;
export const CURRICULUM_SHEET = "Plantilla RA-CE";
export const SUMMARY_SHEET = "Resumen y fuentes";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;
export const MAX_OUTCOMES = 100;
export const MAX_CRITERIA = 100;

export const EXPECTED_COLUMNS = [
  "Ciclo",
  "Nivel",
  "Código del módulo",
  "Módulo",
  "Código RA",
  "Descripción RA",
  "Código CE",
  "Descripción CE",
  "Estado de revisión",
  "Fuente normativa",
  "Observaciones",
  "Fuente oficial",
  "Versión curricular",
  "Territorio",
  "Estructura curricular",
] as const;

const REQUIRED = [
  "Ciclo",
  "Código del módulo",
  "Módulo",
  "Código RA",
  "Descripción RA",
  "Código CE",
  "Descripción CE",
  "Fuente normativa",
  "Versión curricular",
  "Territorio",
] as const;

export class CurriculumParseError extends Error {}

export type CurriculumCandidate = {
  key: string;
  cycleName: string;
  level: string;
  moduleName: string;
  officialCode: string;
  sourceTitle: string;
  sourceUrl: string;
  curriculumVersion: string;
  territory: string;
  outcomes: ForumCurriculumOutcome[];
  warnings: string[];
  firstRow: number;
};

export type ParsedCurriculumFile = {
  kind: "xlsx" | "json";
  workbook: string;
  familyVerified: boolean;
  warnings: string[];
  candidates: CurriculumCandidate[];
};

const cell = (v: unknown): string =>
  v == null ? "" : String(v).replace(/\u00a0/g, " ").trim();

/** Extracts title + official https URL (BOE / Gobierno de Canarias) from the "Fuente normativa" column. */
export function parseNormativeSource(raw: string): { sourceTitle: string; sourceUrl: string } {
  const text = cell(raw);
  const beforeConsulta = text.split(/\s*\|\s*Consulta/i)[0] ?? text;
  const urls = beforeConsulta.match(/https:\/\/[^\s|]+/gi) ?? [];
  const official = urls
    .map((u) => u.replace(/[.,;)]+$/, ""))
    .find((u) => /^https:\/\/([a-z0-9-]+\.)*(boe\.es|gobiernodecanarias\.org)(\/|$)/i.test(u));
  const sourceTitle = beforeConsulta
    .replace(/https?:\/\/[^\s|]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s.;,]+$/, "")
    .trim();
  return { sourceTitle, sourceUrl: official ?? "" };
}

/** Reads the family from the "Resumen y fuentes" sheet. Returns null if not present. */
export function readFamily(summary: unknown[][] | null | undefined): string | null {
  if (!summary) return null;
  for (const row of summary) {
    if (cell(row?.[0]).toLowerCase() === "familia profesional") return cell(row?.[1]) || null;
  }
  return null;
}

export function candidateKey(cycleName: string, moduleName: string, officialCode: string) {
  return `${cycleName}\u241f${officialCode}\u241f${moduleName}`;
}

/**
 * Parses the "Plantilla RA-CE" rows (header row included). Groups by cycle + module code + module
 * name; never merges same-named modules in different cycles. Codes are preserved verbatim.
 */
export function parseCurriculumRows(
  rows: unknown[][],
  options: { workbook: string; summary?: unknown[][] | null },
): ParsedCurriculumFile {
  const warnings: string[] = [];
  if (!rows.length) throw new CurriculumParseError(`La hoja '${CURRICULUM_SHEET}' está vacía.`);
  if (rows.length - 1 > MAX_ROWS)
    throw new CurriculumParseError(`La hoja tiene más de ${MAX_ROWS} filas. Divide el fichero.`);

  const family = readFamily(options.summary);
  if (family && family !== CURRICULUM_FAMILY)
    throw new CurriculumParseError(
      `La familia profesional del libro es «${family}». Solo se admite ${CURRICULUM_FAMILY}.`,
    );
  if (!family)
    warnings.push(
      `No se encontró la familia profesional en '${SUMMARY_SHEET}'. Comprueba manualmente que el libro es de ${CURRICULUM_FAMILY}.`,
    );

  const header = (rows[0] ?? []).map(cell);
  const idx: Record<string, number> = {};
  for (const col of EXPECTED_COLUMNS) idx[col] = header.indexOf(col);
  const missing = REQUIRED.filter((c) => idx[c] < 0);
  if (missing.length)
    throw new CurriculumParseError(`Faltan columnas obligatorias: ${missing.join(", ")}.`);

  type Work = CurriculumCandidate & {
    sources: Set<string>;
    versions: Set<string>;
    territories: Set<string>;
    raMap: Map<string, ForumCurriculumOutcome>;
    ceSeen: Set<string>;
  };
  const groups = new Map<string, Work>();
  const blocked = new Map<string, string>();
  const get = (r: unknown[], c: string) => (idx[c] >= 0 ? cell(r[idx[c]]) : "");

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const rowNo = i + 1;
    if (r.every((v) => cell(v) === "")) continue;
    // The reviewed workbook includes tutorial subjects and historical incidents
    // explicitly without their own RA/CE. They are not deletion instructions.
    if (["Código RA", "Descripción RA", "Código CE", "Descripción CE"].every(c => !get(r, c))
      && get(r, "Ciclo") && get(r, "Módulo") && get(r, "Observaciones")) {
      warnings.push(`Fila ${rowNo}: «${get(r, "Módulo")}» (${get(r, "Ciclo")}) no tiene RA/CE en la hoja; no se propone actualizarlo. ${get(r, "Observaciones")}`);
      continue;
    }
    // Some reviewed FPA areas have no official module code. Keep their rows
    // visible, but require the reviewer to supply an identity before preview.
    const empty = REQUIRED.filter((c) => c !== "Código del módulo" && !get(r, c));
    if (empty.length)
      throw new CurriculumParseError(`Fila ${rowNo} incompleta: falta ${empty.join(", ")}.`);

    const cycleName = get(r, "Ciclo");
    const moduleName = get(r, "Módulo");
    const officialCode = get(r, "Código del módulo");
    const key = candidateKey(cycleName, moduleName, officialCode);
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        cycleName,
        moduleName,
        officialCode,
        level: get(r, "Nivel"),
        sourceTitle: "",
        sourceUrl: "",
        curriculumVersion: "",
        territory: "",
        outcomes: [],
        warnings: [],
        firstRow: rowNo,
        sources: new Set(),
        versions: new Set(),
        territories: new Set(),
        raMap: new Map(),
        ceSeen: new Set(),
      };
      groups.set(key, g);
    }
    g.sources.add(get(r, "Fuente normativa"));
    g.versions.add(get(r, "Versión curricular"));
    g.territories.add(get(r, "Territorio"));

    const raCode = get(r, "Código RA");
    const raDesc = get(r, "Descripción RA");
    let ra = g.raMap.get(raCode);
    if (!ra) {
      if (g.outcomes.length >= MAX_OUTCOMES)
        throw new CurriculumParseError(`«${moduleName}» supera ${MAX_OUTCOMES} RA (fila ${rowNo}).`);
      ra = { code: raCode, description: raDesc, order: g.outcomes.length + 1, criteria: [] };
      g.raMap.set(raCode, ra);
      g.outcomes.push(ra);
    } else if (ra.description !== raDesc) {
      blocked.set(key, `Fila ${rowNo}: el RA ${raCode} de «${moduleName}» (${cycleName}) aparece con otra descripción.`);
      continue;
    }
    const ceCode = get(r, "Código CE");
    const ceKey = `${raCode}\u241f${ceCode}`;
    if (g.ceSeen.has(ceKey)) {
      blocked.set(key, `Fila ${rowNo}: el CE ${ceCode} del ${raCode} de «${moduleName}» está duplicado.`);
      continue;
    }
    if (ra.criteria.length >= MAX_CRITERIA)
      throw new CurriculumParseError(`El ${raCode} de «${moduleName}» supera ${MAX_CRITERIA} CE.`);
    g.ceSeen.add(ceKey);
    ra.criteria.push({ code: ceCode, description: get(r, "Descripción CE"), order: ra.criteria.length + 1 });
  }

  const candidates: CurriculumCandidate[] = [];
  for (const g of groups.values()) {
    if (blocked.has(g.key)) {
      warnings.push(`${blocked.get(g.key)} No se propone actualizar este módulo: resuelve la incidencia sin borrar ni renumerar códigos automáticamente.`);
      continue;
    }
    const w: string[] = [];
    if (!g.officialCode) w.push("La hoja no indica código oficial del módulo. No se podrá aplicar una revisión sin una identidad oficial confirmada; no inventes un código.");
    const [firstSource] = g.sources;
    const src = parseNormativeSource(firstSource ?? "");
    if (g.sources.size > 1) w.push("Hay varias fuentes normativas distintas; se propone la primera. Revísala.");
    if (!src.sourceUrl) w.push("No se encontró un enlace https oficial (BOE o Gobierno de Canarias). Complétalo antes de comparar.");
    if (g.versions.size > 1) w.push("Hay varias versiones curriculares; se propone la primera.");
    if (g.territories.size > 1) w.push("Hay varios territorios; se propone el primero.");
    candidates.push({
      key: g.key,
      cycleName: g.cycleName,
      level: g.level,
      moduleName: g.moduleName,
      officialCode: g.officialCode,
      sourceTitle: src.sourceTitle,
      sourceUrl: src.sourceUrl,
      curriculumVersion: [...g.versions][0] ?? "",
      territory: [...g.territories][0] ?? "",
      outcomes: g.outcomes,
      warnings: w,
      firstRow: g.firstRow,
    });
  }
  if (!candidates.length) throw new CurriculumParseError(blocked.values().next().value ?? "La hoja no contiene filas de RA/CE.");
  return { kind: "xlsx", workbook: options.workbook, familyVerified: !!family, warnings, candidates };
}

const str = (v: unknown, field: string, max: number): string => {
  if (typeof v !== "string" || !v.trim()) throw new CurriculumParseError(`El campo ${field} es obligatorio.`);
  if (v.length > max) throw new CurriculumParseError(`El campo ${field} supera ${max} caracteres.`);
  return v.trim();
};

/** Validates a normalized ForumCurriculumInput JSON (single module). */
export function parseCurriculumJson(text: string, workbook: string): ParsedCurriculumFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CurriculumParseError("El fichero JSON no es válido.");
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || Array.isArray(d))
    throw new CurriculumParseError("El JSON debe ser un objeto ForumCurriculumInput de un único módulo.");
  if (d.family !== CURRICULUM_FAMILY)
    throw new CurriculumParseError(`El campo family debe ser exactamente «${CURRICULUM_FAMILY}».`);
  const moduleName = str(d.moduleName, "moduleName", 500);
  const cycleName = str(d.cycleName, "cycleName", 500);
  const officialCode = str(d.officialCode, "officialCode", 80);
  const sourceTitle = str(d.sourceTitle, "sourceTitle", 500);
  const sourceUrl = typeof d.sourceUrl === "string" ? d.sourceUrl.trim() : "";
  const curriculumVersion = str(d.curriculumVersion, "curriculumVersion", 200);
  const territory = str(d.territory, "territory", 200);
  if (!Array.isArray(d.outcomes) || !d.outcomes.length)
    throw new CurriculumParseError("outcomes debe contener al menos un RA.");
  if (d.outcomes.length > MAX_OUTCOMES) throw new CurriculumParseError(`Más de ${MAX_OUTCOMES} RA.`);
  const raCodes = new Set<string>();
  const outcomes: ForumCurriculumOutcome[] = d.outcomes.map((o: unknown, i: number) => {
    const ro = (o ?? {}) as Record<string, unknown>;
    const code = str(ro.code, `outcomes[${i}].code`, 80);
    if (raCodes.has(code)) throw new CurriculumParseError(`El RA ${code} está repetido.`);
    raCodes.add(code);
    const description = str(ro.description, `outcomes[${i}].description`, 15000);
    if (!Array.isArray(ro.criteria) || !ro.criteria.length)
      throw new CurriculumParseError(`El RA ${code} no tiene CE.`);
    if (ro.criteria.length > MAX_CRITERIA) throw new CurriculumParseError(`El RA ${code} supera ${MAX_CRITERIA} CE.`);
    const ceCodes = new Set<string>();
    const criteria = ro.criteria.map((c: unknown, j: number) => {
      const rc = (c ?? {}) as Record<string, unknown>;
      const cc = str(rc.code, `outcomes[${i}].criteria[${j}].code`, 80);
      if (ceCodes.has(cc)) throw new CurriculumParseError(`El CE ${cc} del ${code} está duplicado.`);
      ceCodes.add(cc);
      return {
        code: cc,
        description: str(rc.description, `outcomes[${i}].criteria[${j}].description`, 15000),
        order: typeof rc.order === "number" && Number.isInteger(rc.order) ? rc.order : j + 1,
      };
    });
    return {
      code,
      description,
      order: typeof ro.order === "number" && Number.isInteger(ro.order) ? ro.order : i + 1,
      criteria,
    };
  });
  return {
    kind: "json",
    workbook: typeof d.workbook === "string" && d.workbook.trim() ? d.workbook.trim() : workbook,
    familyVerified: true,
    warnings: [],
    candidates: [
      {
        key: candidateKey(cycleName, moduleName, officialCode),
        cycleName,
        level: "",
        moduleName,
        officialCode,
        sourceTitle,
        sourceUrl,
        curriculumVersion,
        territory,
        outcomes,
        warnings: [],
        firstRow: 0,
      },
    ],
  };
}

/** Browser entry point: size check, then xlsx (dynamic import) or JSON. */
export async function readCurriculumFile(file: File): Promise<ParsedCurriculumFile> {
  if (file.size > MAX_FILE_BYTES) throw new CurriculumParseError("El fichero supera el límite de 5 MB.");
  if (file.size === 0) throw new CurriculumParseError("El fichero está vacío.");
  const name = file.name.slice(0, 250);
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json")) return parseCurriculumJson(await file.text(), name);
  if (!lower.endsWith(".xlsx")) throw new CurriculumParseError("Formato no admitido. Usa .xlsx o .json.");
  const XLSX = await import("xlsx");
  let wb: import("xlsx").WorkBook;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type: "array", sheetRows: MAX_ROWS + 2 });
  } catch {
    throw new CurriculumParseError("No se pudo leer el libro .xlsx.");
  }
  const sheet = wb.Sheets[CURRICULUM_SHEET];
  if (!sheet) throw new CurriculumParseError(`El libro no contiene la hoja '${CURRICULUM_SHEET}'.`);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false });
  const summarySheet = wb.Sheets[SUMMARY_SHEET];
  const summary = summarySheet
    ? XLSX.utils.sheet_to_json<unknown[]>(summarySheet, { header: 1, defval: "", raw: false })
    : null;
  return parseCurriculumRows(rows, { workbook: name, summary });
}

export function toCurriculumInput(
  c: CurriculumCandidate,
  workbook: string,
  meta: Pick<ForumCurriculumInput, "officialCode" | "sourceTitle" | "sourceUrl" | "curriculumVersion" | "territory">,
): ForumCurriculumInput {
  return {
    family: CURRICULUM_FAMILY,
    moduleName: c.moduleName,
    cycleName: c.cycleName,
    workbook,
    officialCode: meta.officialCode.trim(),
    sourceTitle: meta.sourceTitle.trim(),
    sourceUrl: meta.sourceUrl.trim(),
    curriculumVersion: meta.curriculumVersion.trim(),
    territory: meta.territory.trim(),
    outcomes: c.outcomes,
  };
}
