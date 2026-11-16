import { pickColumn, type SheetRows } from "./sheets";

/**
 * Parser for the "COGNIA - TAPE Programs" workbook: one row per program under
 * review with LEA, publish month and day, cluster, program, ALSDE administrator,
 * reviewers, and the CTE Director. Produces a plan the admin previews before
 * anything is written.
 */

export type CogniaRow = {
  lea: string;
  publishMonth: number;
  publishDay: number;
  cluster: string;
  program: string;
  adminName: string;
  adminEmail: string;
  reviewer1Name: string;
  reviewer1Email: string;
  reviewer2Name: string;
  reviewer2Email: string;
  directorName: string;
  directorEmail: string;
};

export type CogniaLea = {
  lea: string;
  publishMonth: number;
  publishDay: number;
  reviewMonth: number;
  reviewYear: number;
  publishDate: string;
  director: { name: string; email: string } | null;
  programs: { program: string; cluster: string; admin: { name: string; email: string } | null; reviewers: { name: string; email: string }[] }[];
};

export type CogniaPlan = { sheet: string; leas: CogniaLea[]; problems: string[]; rowCount: number };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function monthNumber(text: string) {
  const t = text.trim().toLowerCase();
  const i = MONTHS.findIndex((m) => m === t || m.startsWith(t.slice(0, 3)));
  return i >= 0 ? i + 1 : Number(t) || 0;
}

/**
 * The Cognia "publish" date is the notification release. Reviews happen the
 * following month, except November releases, which are January reviews.
 */
export function reviewMonthFor(publishMonth: number, cycleStartYear: number) {
  const reviewMonth = publishMonth === 11 ? 1 : publishMonth === 12 ? 1 : publishMonth + 1;
  const reviewYear = reviewMonth >= 7 ? cycleStartYear : cycleStartYear + 1;
  return { reviewMonth, reviewYear };
}

export function parseCogniaList(sheets: SheetRows[], cycleStartYear: number): CogniaPlan {
  const problems: string[] = [];
  const sheet = sheets.find((s) => pickColumn(s.headers, ["lea"]) && pickColumn(s.headers, ["program"])) ?? sheets[0];
  if (!sheet) return { sheet: "", leas: [], problems: ["The workbook has no sheets with data."], rowCount: 0 };
  const h = sheet.headers;
  const col = {
    lea: pickColumn(h, ["lea", "system", /^lea_/]),
    month: pickColumn(h, ["publish_month", /month/]),
    day: pickColumn(h, ["publish_date", "publish_day", /^day$/]),
    cluster: pickColumn(h, ["cluster"]),
    program: pickColumn(h, ["program", /^program_name/]),
    admin: pickColumn(h, ["alsde_administrator", /administrator$/]),
    adminEmail: pickColumn(h, ["alsde_administrator_email", /administrator_email/]),
    r1: pickColumn(h, ["alsde_reviewer_1", /reviewer_1$/, "reviewer"]),
    r1Email: pickColumn(h, ["alsde_reviewer_1_email", /reviewer_1_email/, "reviewer_email"]),
    r2: pickColumn(h, ["alsde_reviewer_2", /reviewer_2$/]),
    r2Email: pickColumn(h, ["alsde_reviewer_2_email", /reviewer_2_email/]),
    director: pickColumn(h, ["cte_director", /director$/]),
    directorEmail: pickColumn(h, ["cte_director_email", /director_email/]),
  };
  for (const [k, v] of Object.entries(col)) if (!v && ["lea", "month", "program"].includes(k)) problems.push(`Required column not found: ${k}.`);
  if (problems.length) return { sheet: sheet.sheet, leas: [], problems, rowCount: sheet.rows.length };

  const byLea = new Map<string, CogniaLea>();
  const val = (r: Record<string, string>, key: string | null) => (key ? (r[key] ?? "") : "");
  sheet.rows.forEach((r, i) => {
    const lea = (r[col.lea!] ?? "").trim();
    const program = (r[col.program!] ?? "").trim();
    const publishMonth = monthNumber(r[col.month!] ?? "");
    if (!lea || !program) return problems.push(`Row ${i + 2}: missing LEA or program.`);
    if (!publishMonth) return problems.push(`Row ${i + 2}: publish month "${r[col.month!]}" not recognized.`);
    const publishDay = Number(col.day ? r[col.day] : 0) || 13;
    const { reviewMonth, reviewYear } = reviewMonthFor(publishMonth, cycleStartYear);
    const publishYear = publishMonth >= 7 ? cycleStartYear : cycleStartYear + 1;
    const entry = byLea.get(lea) ?? {
      lea, publishMonth, publishDay, reviewMonth, reviewYear,
      publishDate: `${publishYear}-${String(publishMonth).padStart(2, "0")}-${String(publishDay).padStart(2, "0")}`,
      director: null, programs: [],
    };
    if (!entry.director && val(r, col.director)) entry.director = { name: val(r, col.director).trim(), email: val(r, col.directorEmail).trim().toLowerCase() };
    const reviewers: { name: string; email: string }[] = [];
    if (val(r, col.r1)) reviewers.push({ name: val(r, col.r1).trim(), email: val(r, col.r1Email).trim().toLowerCase() });
    if (val(r, col.r2)) reviewers.push({ name: val(r, col.r2).trim(), email: val(r, col.r2Email).trim().toLowerCase() });
    if (!reviewers.length) problems.push(`Row ${i + 2}: ${lea} / ${program} has no reviewer.`);
    entry.programs.push({
      program,
      cluster: val(r, col.cluster).trim(),
      admin: val(r, col.admin) ? { name: val(r, col.admin).trim(), email: val(r, col.adminEmail).trim().toLowerCase() } : null,
      reviewers,
    });
    byLea.set(lea, entry);
  });
  return { sheet: sheet.sheet, leas: [...byLea.values()], problems, rowCount: sheet.rows.length };
}
