import "server-only";
import type { ProgramData } from "@/lib/components/program";
import { fmtDate, fmtDateTime, fmtRange, statusLabel } from "@/lib/format";

/** The program review report as plain data, shared by the HTML page and the PDF. */
export function buildReport(data: ProgramData) {
  const { dp, lea, year, catalog, school, teachers, qpis, site, sections } = data;
  const score = (code: string, role: "director" | "reviewer") => site?.scores.find((s) => s.qpi_code === code && s.scorer_role === role);
  const applicable = new Set(site?.applicableCodes ?? []);
  const rows = qpis.map((q) => ({ code: q.code, title: q.title, applies: applicable.has(q.code) || !site, director: score(q.code, "director"), reviewer: score(q.code, "reviewer"), ase: !applicable.has(q.code) && !!site }));
  const counts = { level2: rows.filter((r) => r.reviewer?.value === "2").length, level1: rows.filter((r) => r.reviewer?.value === "1").length, na: rows.filter((r) => r.reviewer?.value === "NA").length, applicable: rows.filter((r) => r.applies).length };
  return {
    title: `${dp.program_code} ${catalog?.name ?? "Program"}`,
    lea: lea?.name ?? "", systemCode: lea?.system_code ?? "", year: year?.label ?? "", school: school ? `${school.school_code} ${school.name}` : "System-wide",
    teachers: teachers.map((t) => t.display_name).join(", ") || "None listed",
    delivery: `${dp.delivery_type}${dp.dual_scenario ? ` scenario ${dp.dual_scenario}` : ""}${dp.ase_accredited ? ", ASE accredited" : ""}`,
    visit: site ? fmtRange(site.visit_start, site.visit_end) : "Not selected",
    reviewers: site?.reviewers.map((r) => r.display_name ?? r.email).join(", ") ?? "",
    status: site ? (site.locked ? `Finalized ${fmtDateTime(site.finalized_at)}` : statusLabel(site.status)) : "Not under review",
    rows, counts,
    findings: (site?.findings ?? []).map((f) => ({ code: f.qpi_code, body: f.body, status: f.status, teacher: teachers.find((t) => t.id === f.teacher_id)?.display_name ?? null, cleared: f.cleared_at ? `${fmtDate(f.cleared_at)}: ${f.clearing_note ?? ""}` : null })),
    samples: (site?.samples ?? []).map((s) => ({ code: s.qpi_code, kind: statusLabel(s.kind), sampled: s.items_sampled, passed: s.items_passed })),
    comments: sections.map((sec) => ({ section: `${sec.code} ${sec.title}`, reviewer: site?.comments.find((c) => c.section_code === sec.code && c.author_role === "reviewer")?.body ?? null, director: site?.comments.find((c) => c.section_code === sec.code && c.author_role === "director")?.body ?? null })).filter((c) => c.reviewer || c.director),
    epic: site?.epic ? (data.descriptors.map((d) => ({ text: d.text, result: site.epicScores.find((e) => e.descriptor_id === d.id) })).filter((d) => d.result).map((d) => ({ text: d.text, value: statusLabel(d.result!.value) }))) : [],
    deskAudit: site?.deskAudit?.sent_at ? site.deskAudit.initial_findings : null,
    generatedAt: fmtDateTime(new Date().toISOString()),
  };
}
export type Report = ReturnType<typeof buildReport>;
