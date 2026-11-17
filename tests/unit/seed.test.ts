import { describe, expect, it } from "vitest";
import { generate } from "../../supabase/seed/generate.mjs";

describe("seed data generator", () => {
  it("is deterministic for a given seed", () => {
    expect(JSON.stringify(generate(7))).toBe(JSON.stringify(generate(7)));
    expect(JSON.stringify(generate(7))).not.toBe(JSON.stringify(generate(8)));
  });

  it("uses only fabricated domains and system codes", () => {
    const data = generate();
    for (const lea of data.leas) {
      expect(lea.domain.endsWith(".example.edu")).toBe(true);
      expect(Number(lea.code)).toBeGreaterThanOrEqual(900);
      for (const t of lea.teachers) expect(t.email.endsWith(lea.domain)).toBe(true);
    }
    for (const s of Object.values(data.staff).flat()) expect(s.email.endsWith("state.example.gov")).toBe(true);
  });

  it("declares programs from the catalog only", () => {
    const data = generate();
    const codes = new Set(data.programs.map((p) => p.code));
    for (const lea of data.leas) for (const d of lea.declared) expect(codes.has(d.programCode)).toBe(true);
  });
});
