import { describe, expect, it } from "vitest";
import { monthNumber, parseMaster, parseScheduleForm } from "../../lib/import/master";

const sheets = [
  { sheet: "Program Master", headers: ["program_code", "program_name", "cluster", "coop"], rows: [{ program_code: "010", program_name: "General Agriculture", cluster: "02 Agriculture", coop: "" }, { program_code: "x", program_name: "", cluster: "", coop: "" }, { program_code: "25", program_name: "Cooperative Education", cluster: "15 Work-Based Learning", coop: "Y" }] },
  { sheet: "District Directory", headers: ["system_code", "system_name", "lea_type", "cte_director", "director_email"], rows: [{ system_code: "901", system_name: "Riverbend County", lea_type: "", cte_director: "Avery Example", director_email: "director@riverbend.example.edu" }, { system_code: "9", system_name: "Bad", lea_type: "", cte_director: "", director_email: "nope" }] },
  { sheet: "Schools", headers: ["system_code", "school_code", "school_name", "school_type"], rows: [{ system_code: "901", school_code: "10", school_name: "Riverbend High School", school_type: "High School" }] },
  { sheet: "Schedule", headers: ["system_code", "system", "review_month", "review_year"], rows: [{ system_code: "901", system: "Riverbend County", review_month: "January", review_year: "" }, { system_code: "902", system: "Pine Ridge City", review_month: "Oct", review_year: "2026" }, { system_code: "903", system: "Elsewhere", review_month: "Soon", review_year: "" }] },
  { sheet: "Notes", headers: ["anything"], rows: [{ anything: "x" }] },
];

describe("master spreadsheet", () => {
  const plan = parseMaster(sheets, 2026);
  it("recognizes each sheet by its headers and reports problems per row", () => {
    expect(plan.catalog?.rows.map((r) => [r.code, r.clusterCode, r.isCoop, r.problems.length])).toEqual([["10", "02", false, 0], ["x", "", false, 3], ["25", "15", true, 0]]);
    expect(plan.leas?.rows.map((r) => [r.systemCode, r.leaType, r.problems])).toEqual([["901", "county", []], ["009", "county", ["director email looks wrong"]]]);
    expect(plan.schools?.rows[0]).toMatchObject({ systemCode: "901", schoolCode: "0010", schoolType: "high school" });
    expect(plan.schedule?.rows.map((r) => [r.reviewMonth, r.reviewYear, r.problems.length])).toEqual([[1, 2027, 0], [10, 2026, 0], [null, null, 1]]);
    expect(plan.ignored).toEqual(["Notes"]);
  });
  it("reads month names and numbers", () => {
    expect(monthNumber("November")).toBe(11);
    expect(monthNumber("feb")).toBe(2);
    expect(monthNumber("3")).toBe(3);
    expect(monthNumber("13")).toBeNull();
  });
});

describe("scheduling form responses", () => {
  it("reads a system and two date ranges", () => {
    const out = parseScheduleForm([{ sheet: "Responses", headers: ["timestamp", "school_system", "first_choice_start", "first_choice_end", "second_choice_start", "second_choice_end", "notes"], rows: [{ timestamp: "x", school_system: "Riverbend County", first_choice_start: "2027-01-19", first_choice_end: "2027-01-21", second_choice_start: "2027-01-26", second_choice_end: "", notes: "Avoid Fridays" }] }]);
    expect(out.problems).toEqual([]);
    expect(out.rows[0]).toMatchObject({ systemName: "Riverbend County", choice1Start: "2027-01-19", choice1End: "2027-01-21", choice2Start: "2027-01-26", choice2End: "2027-01-26", notes: "Avoid Fridays", problems: [] });
  });
});
