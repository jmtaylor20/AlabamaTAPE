// Seed the 2026-2027 instrument as a published version. Idempotent: does nothing if the version exists.
//   DATABASE_URL=postgres://... node scripts/db/seed-instrument.mjs
//   node scripts/db/seed-instrument.mjs --print-sql
import pg from "pg";
import { INSTRUMENT } from "../../supabase/seed/instrument-2026-2027.mjs";

export function instrumentSql(inst = INSTRUMENT) {
  const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replaceAll("'", "''")}'`);
  const out = [];
  out.push(`do $seed$
declare v uuid; s uuid; qp uuid; y uuid;
begin
  select id into y from public.school_years where label = ${q(inst.schoolYear)};
  if y is null then raise exception 'school year % not found', ${q(inst.schoolYear)}; end if;
  if exists (select 1 from public.instrument_versions where school_year_id = y and level = ${q(inst.level)} and label = ${q(inst.label)}) then return; end if;
  insert into public.instrument_versions (school_year_id, level, label, status, notes) values (y, ${q(inst.level)}, ${q(inst.label)}, 'draft', ${q(inst.notes)}) returning id into v;`);
  inst.scoringRules.forEach((r) => out.push(`  insert into public.scoring_rules (version_id, rule_key, label, operator, threshold, epic_threshold, unit) values (v, ${q(r.key)}, ${q(r.label)}, ${q(r.operator)}, ${r.threshold}, ${r.epicThreshold ?? "null"}, ${q(r.unit)});`));
  for (const role of ["director", "reviewer"]) inst.checklists[role].forEach((t, i) => out.push(`  insert into public.checklist_items (version_id, role, text, sort) values (v, ${q(role)}, ${q(t)}, ${i + 1});`));
  inst.sections.forEach((sec, si) => {
    out.push(`  insert into public.instrument_sections (version_id, code, title, purpose, sort) values (v, ${q(sec.code)}, ${q(sec.title)}, ${q(sec.purpose)}, ${si + 1}) returning id into s;`);
    sec.qpis.forEach((qpi, qi) => {
      out.push(`  insert into public.qpis (version_id, section_id, code, title, descriptor, applies_to, assurance_based, onsite, per_teacher, satisfied_by_ase, dual_scenario3_included, random_audit_kind, allows_na, sort)
    values (v, s, ${q(qpi.code)}, ${q(qpi.title)}, ${q(qpi.descriptor)}, ${q(qpi.appliesTo ?? "non_coop")}, ${!!qpi.assurance}, ${!!qpi.onsite}, ${!!qpi.perTeacher}, ${!!qpi.ase}, ${!!qpi.dual3}, ${q(qpi.audit ?? null)}, true, ${qi + 1}) returning id into qp;`);
      (qpi.subitems ?? []).forEach((sub, k) => {
        const text = typeof sub === "string" ? sub : sub.text;
        const na = typeof sub === "string" ? false : !!sub.na;
        out.push(`  insert into public.qpi_subitems (qpi_id, text, allows_na, sort) values (qp, ${q(text)}, ${na}, ${k + 1});`);
      });
    });
    sec.epic.forEach((e, k) => out.push(`  insert into public.epic_descriptors (version_id, section_id, text, sort) values (v, s, ${q(e)}, ${k + 1});`));
  });
  out.push(`  update public.instrument_versions set status = 'published', published_at = now() where id = v;
end $seed$;`);
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sql = instrumentSql();
  if (process.argv.includes("--print-sql")) {
    console.log(sql);
  } else {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log("instrument seeded");
  }
}
