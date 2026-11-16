import { pickColumn, type SheetRows } from "./sheets";

/**
 * The master spreadsheet: program catalog (Program Master), systems and
 * schools (District Directory), and the compliance schedule (Schedule).
 * Sheets are recognized by their headers, not their names, and every row
 * is reported with its problems before anything is written.
 */

export type CatalogRow = { row: number; code: string; name: string; clusterCode: string; clusterName: string; isCoop: boolean; problems: string[] };
export type LeaRow = { row: number; systemCode: string; name: string; leaType: string; directorName: string; directorEmail: string; problems: string[] };
export type SchoolRow = { row: number; systemCode: string; schoolCode: string; name: string; schoolType: string; problems: string[] };
export type ScheduleRow = { row: number; systemCode: string; systemName: string; reviewMonth: number | null; reviewYear: number | null; problems: string[] };
export type MasterPlan = { catalog: { sheet: string; rows: CatalogRow[] } | null; leas: { sheet: string; rows: LeaRow[] } | null; schools: { sheet: string; rows: SchoolRow[] } | null; schedule: { sheet: string; rows: ScheduleRow[] } | null; ignored: string[] };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function monthNumber(s: string) {
  const t = s.trim().toLowerCase();
  if (/^\d{1,2}$/.test(t)) { const n = Number(t); return n >= 1 && n <= 12 ? n : null; }
  const i = MONTHS.findIndex((m) => m.startsWith(t.slice(0, 3)));
  return i >= 0 ? i + 1 : null;
}

const pad = (s: string, n: number) => (s ? s.replace(/\D/g, "").padStart(n, "0").slice(-n) : "");

export function parseMaster(sheets: SheetRows[], cycleStartYear: number): MasterPlan {
  const plan: MasterPlan = { catalog: null, leas: null, schools: null, schedule: null, ignored: [] };
  for (const s of sheets) {
    const h = s.headers;
    const col = (c: (string | RegExp)[]) => pickColumn(h, c);
    const get = (r: Record<string, string>, k: string | null) => (k ? (r[k] ?? "").trim() : "");
    const programCode = col(["program_code", /^program_?(code|number|id)$/, /^code$/]);
    const programName = col(["program_name", "program", /^program_?(name|title)$/]);
    const cluster = col(["cluster", "cluster_name", /cluster/]);
    const schoolCode = col(["school_code", /school_?(code|number|id)/]);
    const schoolName = col(["school_name", "school", /^school$/]);
    const systemCode = col(["system_code", "lea_code", /^(system|lea|district)_?(code|number|id)$/]);
    const systemName = col(["system_name", "lea_name", "district_name", "system", "lea", "district"]);
    const month = col(["review_month", "month", /month/]);
    const year = col(["review_year", "year", /year/]);
    if (!plan.catalog && programCode && programName && !schoolCode) {
      const coop = col([/coop/, /co_op/]);
      plan.catalog = { sheet: s.sheet, rows: s.rows.map((r, i) => {
        const out: CatalogRow = { row: i + 2, code: get(r, programCode).replace(/^0+(?=\d)/, ""), name: get(r, programName), clusterCode: "", clusterName: get(r, cluster), isCoop: /^(y|yes|true|1)$/i.test(get(r, coop)) || /cooperative/i.test(get(r, programName)), problems: [] };
        const m = /^(\d{2})\b/.exec(out.clusterName); if (m) { out.clusterCode = m[1]!; out.clusterName = out.clusterName.replace(/^\d{2}\s*[-:]?\s*/, ""); }
        if (!/^\d{1,3}$/.test(out.code)) out.problems.push("program code is not one to three digits");
        if (!out.name) out.problems.push("missing program name");
        if (!out.clusterName && !out.clusterCode) out.problems.push("missing cluster");
        return out;
      }) };
    } else if (!plan.schools && schoolCode && systemCode) {
      const type = col([/school_?type/, /^type$/]);
      plan.schools = { sheet: s.sheet, rows: s.rows.map((r, i) => {
        const out: SchoolRow = { row: i + 2, systemCode: pad(get(r, systemCode), 3), schoolCode: pad(get(r, schoolCode), 4), name: get(r, schoolName), schoolType: get(r, type).toLowerCase(), problems: [] };
        if (!/^\d{3}$/.test(out.systemCode)) out.problems.push("system code is not three digits");
        if (!/^\d{4}$/.test(out.schoolCode)) out.problems.push("school code is not four digits");
        if (!out.name) out.problems.push("missing school name");
        return out;
      }) };
    } else if (!plan.schedule && (systemCode || systemName) && month && !programCode && !schoolCode) {
      plan.schedule = { sheet: s.sheet, rows: s.rows.map((r, i) => {
        const mo = monthNumber(get(r, month));
        const yrRaw = Number(get(r, year));
        const out: ScheduleRow = { row: i + 2, systemCode: pad(get(r, systemCode), 3), systemName: get(r, systemName), reviewMonth: mo, reviewYear: yrRaw || (mo ? (mo >= 7 ? cycleStartYear : cycleStartYear + 1) : null), problems: [] };
        if (!out.systemCode && !out.systemName) out.problems.push("missing system");
        if (!mo) out.problems.push(`review month "${get(r, month)}" not recognized`);
        return out;
      }) };
    } else if (!plan.leas && systemCode && systemName && !schoolCode && !month) {
      const type = col([/lea_?type/, /^type$/]);
      const dir = col([/director$/, /^cte_director/, /director_name/]);
      const dirEmail = col([/director_email/, /^email$/]);
      plan.leas = { sheet: s.sheet, rows: s.rows.map((r, i) => {
        const name = get(r, systemName);
        const out: LeaRow = { row: i + 2, systemCode: pad(get(r, systemCode), 3), name, leaType: get(r, type).toLowerCase() || (/city/i.test(name) ? "city" : "county"), directorName: get(r, dir), directorEmail: get(r, dirEmail).toLowerCase(), problems: [] };
        if (!/^\d{3}$/.test(out.systemCode)) out.problems.push("system code is not three digits");
        if (!name) out.problems.push("missing system name");
        if (!["county", "city", "charter", "college", "other"].includes(out.leaType)) out.leaType = "other";
        if (out.directorEmail && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out.directorEmail)) out.problems.push("director email looks wrong");
        return out;
      }) };
    } else {
      plan.ignored.push(s.sheet);
    }
  }
  return plan;
}

export type ScheduleFormRow = { row: number; systemCode: string; systemName: string; choice1Start: string; choice1End: string; choice2Start: string; choice2End: string; notes: string; problems: string[] };

/** Responses to the visit scheduling form: a system and two date ranges. */
export function parseScheduleForm(sheets: SheetRows[]): { sheet: string; rows: ScheduleFormRow[]; problems: string[] } {
  const sheet = sheets.find((s) => pickColumn(s.headers, [/choice|first|preferred|option_1|date_1/])) ?? sheets[0];
  if (!sheet) return { sheet: "", rows: [], problems: ["The workbook has no sheets with data."] };
  const h = sheet.headers;
  const col = (c: (string | RegExp)[]) => pickColumn(h, c);
  const get = (r: Record<string, string>, k: string | null) => (k ? (r[k] ?? "").trim() : "");
  const systemCode = col(["system_code", /^(system|lea|district)_?(code|number|id)$/]);
  const systemName = col(["system_name", "lea_name", "district", "system", "lea", /school_system/, /district/]);
  const c1s = col([/first_choice_start/, /choice_1_start/, /first_choice/, /choice_1/, /option_1/, /preferred_start/, /date_1/]);
  const c1e = col([/first_choice_end/, /choice_1_end/, /first_choice_end/, /option_1_end/, /preferred_end/]);
  const c2s = col([/second_choice_start/, /choice_2_start/, /second_choice/, /choice_2/, /option_2/, /alternate_start/, /date_2/]);
  const c2e = col([/second_choice_end/, /choice_2_end/, /option_2_end/, /alternate_end/]);
  const notes = col([/note/, /comment/]);
  const problems: string[] = [];
  if (!systemCode && !systemName) problems.push("No system column found.");
  if (!c1s) problems.push("No first choice date column found.");
  const iso = (s: string) => { if (!s) return ""; const d = new Date(s); return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10); };
  const rows = sheet.rows.map((r, i) => {
    const out: ScheduleFormRow = { row: i + 2, systemCode: pad(get(r, systemCode), 3), systemName: get(r, systemName), choice1Start: iso(get(r, c1s)), choice1End: iso(get(r, c1e)) || iso(get(r, c1s)), choice2Start: iso(get(r, c2s)), choice2End: iso(get(r, c2e)) || iso(get(r, c2s)), notes: get(r, notes), problems: [] };
    if (!out.systemCode && !out.systemName) out.problems.push("missing system");
    if (!out.choice1Start) out.problems.push("first choice date missing or unreadable");
    if (out.choice1End < out.choice1Start) out.problems.push("first choice ends before it starts");
    return out;
  });
  return { sheet: sheet.sheet, rows, problems };
}
