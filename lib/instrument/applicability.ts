/** Which QPIs apply to a program, from the instrument flags and the program's declaration. */

export type QpiFlags = { code: string; title: string; applies_to: string; assurance_based: boolean; onsite: boolean; per_teacher: boolean; satisfied_by_ase: boolean; dual_scenario3_included: boolean; allows_na: boolean; section_id: string; sort: number };
export type ProgramContext = { isCoop: boolean; deliveryType: string; dualScenario: number | null; aseAccredited: boolean };
export type ApplicableQpi<Q extends QpiFlags = QpiFlags> = Q & { satisfiedByAse: boolean; requiredSelfScore: boolean };

export const REQUIRED_SELF_SCORES = ["2.1.A", "2.1.B", "2.1.C", "2.1.D"];

export function applicableQpis<Q extends QpiFlags>(qpis: Q[], ctx: ProgramContext): ApplicableQpi<Q>[] {
  return qpis
    .filter((q) => (ctx.isCoop ? q.applies_to !== "non_coop" : q.applies_to !== "coop_only"))
    .filter((q) => !(ctx.deliveryType === "DUAL" && ctx.dualScenario === 3) || q.dual_scenario3_included)
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }))
    .map((q) => ({ ...q, satisfiedByAse: ctx.aseAccredited && q.satisfied_by_ase, requiredSelfScore: !ctx.isCoop && REQUIRED_SELF_SCORES.includes(q.code) }));
}

export function passRate(takers: number, passers: number) {
  return takers > 0 ? Math.round((passers / takers) * 1000) / 10 : null;
}
