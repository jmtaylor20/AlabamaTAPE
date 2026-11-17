import ExcelJS from "exceljs";

/** A sheet as an array of row objects keyed by normalized header. */
export type SheetRows = { sheet: string; headers: string[]; rows: Record<string, string>[] };

export function normalizeHeader(h: unknown) {
  return String(h ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).trim();
  }
  return String(v).trim();
}

/** Reads every worksheet of an .xlsx buffer. The first non-empty row is the header. */
export async function readWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetRows[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const out: SheetRows[] = [];
  wb.eachSheet((ws) => {
    let headers: string[] | null = null;
    const rows: Record<string, string>[] = [];
    ws.eachRow((row) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
      if (!headers) {
        if (values.some((v) => v)) headers = values.map(normalizeHeader);
        return;
      }
      if (!values.some((v) => v)) return;
      const rec: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) rec[h] = values[i] ?? "";
      });
      rows.push(rec);
    });
    if (headers) out.push({ sheet: ws.name, headers, rows });
  });
  return out;
}

/** Finds the first header matching any of the candidate names or patterns. */
export function pickColumn(headers: string[], candidates: (string | RegExp)[]): string | null {
  for (const c of candidates) {
    const hit = headers.find((h) => (typeof c === "string" ? h === c : c.test(h)));
    if (hit) return hit;
  }
  return null;
}
