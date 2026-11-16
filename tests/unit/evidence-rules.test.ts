import { describe, expect, it } from "vitest";
import { basicScan, kindFor, validateUpload, MAX_FILE_BYTES } from "../../lib/evidence/rules";
import { applicableQpis, passRate } from "../../lib/instrument/applicability";

const pdf = new TextEncoder().encode("%PDF-1.7 fabricated");
const eicar = new TextEncoder().encode("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");

describe("upload rules", () => {
  it("accepts allowlisted types and rejects the rest", () => {
    expect(validateUpload({ name: "syllabus.pdf", size: 10, contentType: "application/pdf", alreadyUsedBytes: 0 })).toMatchObject({ ok: true });
    expect(validateUpload({ name: "photo.JPG", size: 10, contentType: "image/jpeg", alreadyUsedBytes: 0 })).toMatchObject({ ok: true });
    expect(validateUpload({ name: "macro.xlsm", size: 10, contentType: "application/vnd.ms-excel.sheet.macroEnabled.12", alreadyUsedBytes: 0 })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "tool.exe", size: 10, contentType: "application/octet-stream", alreadyUsedBytes: 0 })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "evil.pdf", size: 10, contentType: "text/html", alreadyUsedBytes: 0 })).toMatchObject({ ok: false });
  });
  it("enforces size limits per file and per program", () => {
    expect(validateUpload({ name: "a.pdf", size: MAX_FILE_BYTES + 1, contentType: "application/pdf", alreadyUsedBytes: 0 })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "a.pdf", size: 10, contentType: "application/pdf", alreadyUsedBytes: 1024 * 1024 * 1024 })).toMatchObject({ ok: false });
    expect(validateUpload({ name: "a.pdf", size: 0, contentType: "application/pdf", alreadyUsedBytes: 0 })).toMatchObject({ ok: false });
  });
  it("checks the bytes against the declared type and catches the test signature", () => {
    expect(basicScan(pdf, "a.pdf", "application/pdf").status).toBe("clean");
    expect(basicScan(new TextEncoder().encode("<html>"), "a.pdf", "application/pdf").status).toBe("infected");
    expect(basicScan(eicar, "a.pdf", "application/pdf").status).toBe("infected");
    expect(basicScan(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), "a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").status).toBe("clean");
    expect(basicScan(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), "clip.mp4", "video/mp4").status).toBe("clean");
    expect(kindFor("x.unknown", "")).toBeNull();
  });
});

describe("applicability", () => {
  const qpis = [
    { code: "1.1.A", title: "POW", applies_to: "non_coop", assurance_based: false, onsite: false, per_teacher: true, satisfied_by_ase: false, dual_scenario3_included: true, allows_na: true, section_id: "s", sort: 1 },
    { code: "2.1.A", title: "Syllabus", applies_to: "non_coop", assurance_based: true, onsite: false, per_teacher: false, satisfied_by_ase: false, dual_scenario3_included: false, allows_na: true, section_id: "s", sort: 2 },
    { code: "3.1.A", title: "Scheduling", applies_to: "non_coop", assurance_based: false, onsite: false, per_teacher: false, satisfied_by_ase: true, dual_scenario3_included: false, allows_na: true, section_id: "s", sort: 3 },
    { code: "5.2.A", title: "Co-op", applies_to: "coop_only", assurance_based: false, onsite: false, per_teacher: false, satisfied_by_ase: false, dual_scenario3_included: false, allows_na: true, section_id: "s", sort: 4 },
  ];
  it("separates co-op from everything else and narrows dual scenario 3", () => {
    expect(applicableQpis(qpis, { isCoop: false, deliveryType: "LOCAL", dualScenario: null, aseAccredited: false }).map((q) => q.code)).toEqual(["1.1.A", "2.1.A", "3.1.A"]);
    expect(applicableQpis(qpis, { isCoop: true, deliveryType: "LOCAL", dualScenario: null, aseAccredited: false }).map((q) => q.code)).toEqual(["5.2.A"]);
    expect(applicableQpis(qpis, { isCoop: false, deliveryType: "DUAL", dualScenario: 3, aseAccredited: false }).map((q) => q.code)).toEqual(["1.1.A"]);
    expect(applicableQpis(qpis, { isCoop: false, deliveryType: "DUAL", dualScenario: 1, aseAccredited: false })).toHaveLength(3);
  });
  it("marks ASE-satisfied items and the required self-scores", () => {
    const out = applicableQpis(qpis, { isCoop: false, deliveryType: "LOCAL", dualScenario: null, aseAccredited: true });
    expect(out.find((q) => q.code === "3.1.A")?.satisfiedByAse).toBe(true);
    expect(out.find((q) => q.code === "2.1.A")?.requiredSelfScore).toBe(true);
    expect(out.find((q) => q.code === "1.1.A")?.requiredSelfScore).toBe(false);
  });
  it("computes a pass rate to one decimal", () => {
    expect(passRate(0, 0)).toBeNull();
    expect(passRate(9, 8)).toBe(88.9);
  });
});
