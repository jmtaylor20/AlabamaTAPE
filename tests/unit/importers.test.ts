import { describe, expect, it } from "vitest";
import { parseCogniaList, reviewMonthFor } from "../../lib/import/cognia-list";
import { parseDeclarations } from "../../lib/import/declarations";
import { normalizeHeader, type SheetRows } from "../../lib/import/sheets";

const cognia: SheetRows[] = [
  {
    sheet: "v3",
    headers: ["LEA", "Publish Month", "Publish Date", "Cluster", "Program", "ALSDE Administrator", "ALSDE Administrator Email", "ALSDE Reviewer 1", "ALSDE Reviewer 1 Email", "ALSDE Reviewer 2", "ALSDE Reviewer 2 Email", "CTE Director", "CTE Director Email"].map(normalizeHeader),
    rows: [
      { lea: "Riverbend County", publish_month: "September", publish_date: "15", cluster: "Construction", program: "Welding", alsde_administrator: "A Admin", alsde_administrator_email: "a.admin@state.example.gov", alsde_reviewer_1: "R One", alsde_reviewer_1_email: "r.one@state.example.gov", alsde_reviewer_2: "", alsde_reviewer_2_email: "", cte_director: "D Director", cte_director_email: "d.director@riverbend.example.edu" },
      { lea: "Riverbend County", publish_month: "September", publish_date: "15", cluster: "Agriculture", program: "General Agriculture", alsde_administrator: "", alsde_administrator_email: "", alsde_reviewer_1: "R Two", alsde_reviewer_1_email: "r.two@state.example.gov", alsde_reviewer_2: "R Three", alsde_reviewer_2_email: "r.three@state.example.gov", cte_director: "D Director", cte_director_email: "d.director@riverbend.example.edu" },
      { lea: "Lakeview City", publish_month: "November", publish_date: "13", cluster: "Agriculture", program: "Animal Science", alsde_administrator: "", alsde_administrator_email: "", alsde_reviewer_1: "R Two", alsde_reviewer_1_email: "r.two@state.example.gov", alsde_reviewer_2: "", alsde_reviewer_2_email: "", cte_director: "E Director", cte_director_email: "e.director@lakeview.example.edu" },
    ],
  },
];

describe("Cognia list parser", () => {
  it("groups programs by LEA and derives the review month from the publish month", () => {
    const plan = parseCogniaList(cognia, 2026);
    expect(plan.problems).toEqual([]);
    expect(plan.leas.map((l) => [l.lea, l.reviewMonth, l.reviewYear, l.publishDate])).toEqual([
      ["Riverbend County", 10, 2026, "2026-09-15"],
      ["Lakeview City", 1, 2027, "2026-11-13"],
    ]);
    expect(plan.leas[0]!.programs[1]!.reviewers.map((r) => r.email)).toEqual(["r.two@state.example.gov", "r.three@state.example.gov"]);
    expect(plan.leas[0]!.director).toEqual({ name: "D Director", email: "d.director@riverbend.example.edu" });
  });

  it("maps a November release to a January review", () => {
    expect(reviewMonthFor(11, 2026)).toEqual({ reviewMonth: 1, reviewYear: 2027 });
    expect(reviewMonthFor(9, 2026)).toEqual({ reviewMonth: 10, reviewYear: 2026 });
    expect(reviewMonthFor(3, 2026)).toEqual({ reviewMonth: 4, reviewYear: 2027 });
  });
});

describe("declaration parser", () => {
  it("matches columns by name, normalizes codes, and flags problems", () => {
    const sheets: SheetRows[] = [{
      sheet: "Declared",
      headers: ["system_code", "school_code", "school_name", "location_system", "location_school", "program_code", "program_name", "type", "dual_scenario", "teacher", "teacher_email", "notes"],
      rows: [
        { system_code: "5", school_code: "20", school_name: "Appalachian School", location_system: "005", location_school: "6000", program_code: "099", program_name: "Additive Manufacturing", type: "LOCAL", dual_scenario: "", teacher: "Avery Abernathy", teacher_email: "Avery@Example.edu", notes: "x" },
        { system_code: "005", school_code: "0020", school_name: "", location_system: "", location_school: "", program_code: "17", program_name: "Health Science", type: "DUAL", dual_scenario: "", teacher: "", teacher_email: "", notes: "" },
      ],
    }];
    const plan = parseDeclarations(sheets);
    expect(plan.problems).toEqual([]);
    expect(plan.unmatchedHeaders).toEqual(["notes"]);
    expect(plan.rows[0]).toMatchObject({ systemCode: "005", schoolCode: "0020", locationSystemCode: "005", locationSchoolCode: "6000", programCode: "99", deliveryType: "LOCAL", teacherEmail: "avery@example.edu", problems: [] });
    expect(plan.rows[1]!.problems).toEqual(["dual enrollment row without a scenario"]);
  });
});
