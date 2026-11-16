import { pickColumn, type SheetRows } from "./sheets";

/**
 * Parser for an LEA's declared-program export (PowerSchool or the state
 * declaration file). Columns are matched by name so small header differences
 * between files do not break the import; unmatched columns are reported.
 */

export type DeclaredRow = {
  row: number;
  systemCode: string;
  schoolCode: string;
  schoolName: string;
  locationSystemCode: string;
  locationSchoolCode: string;
  programCode: string;
  programName: string;
  clusterCode: string;
  deliveryType: "LOCAL" | "DUAL" | "ACCESS";
  dualScenario: number | null;
  teacherName: string;
  teacherEmail: string;
  problems: string[];
};

export type DeclarationPlan = { sheet: string; columns: Record<string, string | null>; rows: DeclaredRow[]; unmatchedHeaders: string[]; problems: string[] };

export function parseDeclarations(sheets: SheetRows[]): DeclarationPlan {
  const sheet = sheets.find((s) => pickColumn(s.headers, [/program/]) && pickColumn(s.headers, [/school/])) ?? sheets[0];
  if (!sheet) return { sheet: "", columns: {}, rows: [], unmatchedHeaders: [], problems: ["The workbook has no sheets with data."] };
  const h = sheet.headers;
  const columns = {
    systemCode: pickColumn(h, ["system_code", "lea_code", /^system(_id)?$/, /system_code/]),
    schoolCode: pickColumn(h, ["school_code", /^school(_id)?$/, /home_school_code/, /school_code/]),
    schoolName: pickColumn(h, ["school_name", /school_name/]),
    locationSystemCode: pickColumn(h, ["location_system_code", "location_system", /location_system/]),
    locationSchoolCode: pickColumn(h, ["location_school_code", "location_school", /location_school/]),
    programCode: pickColumn(h, ["program_code", /program_code/, /^program_id$/]),
    programName: pickColumn(h, ["program_name", /program_name/, /^program$/]),
    clusterCode: pickColumn(h, ["cluster_code", /cluster_code/]),
    deliveryType: pickColumn(h, ["type", "delivery_type", /delivery/, /^type$/]),
    dualScenario: pickColumn(h, ["dual_scenario", /scenario/]),
    teacherName: pickColumn(h, ["teacher", "teacher_name", /teacher_name/, /^instructor/]),
    teacherEmail: pickColumn(h, ["teacher_email", /teacher_email/, /^email$/]),
  };
  const used = new Set(Object.values(columns).filter(Boolean));
  const unmatchedHeaders = h.filter((x) => x && !used.has(x));
  const problems: string[] = [];
  for (const k of ["programCode", "schoolCode"] as const) if (!columns[k]) problems.push(`Required column not found: ${k}.`);

  const rows: DeclaredRow[] = sheet.rows.map((r, i) => {
    const get = (k: keyof typeof columns) => (columns[k] ? (r[columns[k]!] ?? "").trim() : "");
    const typeRaw = get("deliveryType").toUpperCase();
    const deliveryType = typeRaw.startsWith("DUAL") ? "DUAL" : typeRaw.startsWith("ACCESS") ? "ACCESS" : "LOCAL";
    const scenarioRaw = get("dualScenario").replace(/[^0-9]/g, "");
    const out: DeclaredRow = {
      row: i + 2,
      systemCode: get("systemCode").padStart(3, "0").slice(-3),
      schoolCode: get("schoolCode").padStart(4, "0").slice(-4),
      schoolName: get("schoolName"),
      locationSystemCode: get("locationSystemCode") ? get("locationSystemCode").padStart(3, "0").slice(-3) : "",
      locationSchoolCode: get("locationSchoolCode") ? get("locationSchoolCode").padStart(4, "0").slice(-4) : "",
      programCode: get("programCode").replace(/^0+(?=\d)/, ""),
      programName: get("programName"),
      clusterCode: get("clusterCode"),
      deliveryType,
      dualScenario: deliveryType === "DUAL" && scenarioRaw ? Number(scenarioRaw) : null,
      teacherName: get("teacherName"),
      teacherEmail: get("teacherEmail").toLowerCase(),
      problems: [],
    };
    if (!out.programCode) out.problems.push("missing program code");
    if (!/^\d{4}$/.test(out.schoolCode)) out.problems.push("school code is not four digits");
    if (out.deliveryType === "DUAL" && !out.dualScenario) out.problems.push("dual enrollment row without a scenario");
    if (out.teacherEmail && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out.teacherEmail)) out.problems.push("teacher email looks wrong");
    return out;
  });
  return { sheet: sheet.sheet, columns, rows, unmatchedHeaders, problems };
}
