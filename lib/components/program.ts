import "server-only";
import type { CurrentUser } from "@/lib/auth/session";
import { applicableQpis, type QpiFlags } from "@/lib/instrument/applicability";
import { createUserClient } from "@/lib/supabase/server";

export type ScoreRow = { qpi_code: string; value: string; na_reason: string | null; comment: string | null; version: number; created_at: string; scorer_role: string };
export type SiteInfo = { id: string; director_submitted_at: string | null; director_submitted_by: string | null; scoring_extended_until: string | null; program_review_id: string; status: string; lea_review_id: string; released_at: string | null; visit_start: string | null; visit_end: string | null; evidence_due: string | null; open: boolean; scores: ScoreRow[] };

/** Everything the program pages need, loaded under the caller's own policies. */
export async function loadProgram(id: string, user: CurrentUser) {
  const supabase = await createUserClient();
  const { data: dp } = await supabase
    .from("declared_programs")
    .select("id, lea_id, school_year_id, program_code, home_school_id, delivery_type, dual_scenario, ase_accredited, epic_requested, status, leas!declared_programs_lea_id_fkey(name, system_code), school_years(label), program_catalog(name, cluster_code, is_coop), home:schools!declared_programs_home_school_id_fkey(name, school_code), declared_program_teachers(teacher_id, teachers(id, display_name))")
    .eq("id", id)
    .maybeSingle();
  if (!dp) return null;
  const lea = dp.leas as unknown as { name: string; system_code: string } | null;
  const year = dp.school_years as unknown as { label: string } | null;
  const catalog = dp.program_catalog as unknown as { name: string; cluster_code: string; is_coop: boolean } | null;
  const school = dp.home as unknown as { name: string; school_code: string } | null;
  const teachers = ((dp.declared_program_teachers as unknown as { teachers: { id: string; display_name: string } | null }[]) ?? []).map((t) => t.teachers).filter((t): t is { id: string; display_name: string } => !!t);

  const { data: version } = await supabase.from("instrument_versions").select("id, label").eq("school_year_id", dp.school_year_id).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle();
  const [{ data: siteId }, { data: files }, { data: credentials }, { data: form }, { data: rules }] = await Promise.all([
    supabase.rpc("site_for_declared_program", { p_dp: id }),
    supabase.from("evidence_files").select("id, category, form_year_label, original_name, content_type, size_bytes, note, teacher_id, uploaded_by, scan_status, scan_detail, quarantined, quarantine_reason, removed_at, created_at, evidence_qpi_links(qpi_code), teachers(display_name), profiles!evidence_files_uploaded_by_fkey(display_name)").eq("declared_program_id", id).order("created_at", { ascending: false }),
    supabase.from("credential_results").select("id, credential_name, test_takers, passers, source_file_id").eq("declared_program_id", id).order("credential_name"),
    supabase.from("form_141").select("id, status, submitted_at, ta_requested_level1, ta_requested_new_teacher, comments, form_141_items(qpi_code, score, corrective_action)").eq("declared_program_id", id).maybeSingle(),
    supabase.from("scoring_rules").select("rule_key, threshold, epic_threshold, unit, label").eq("version_id", version?.id ?? "00000000-0000-0000-0000-000000000000"),
  ]);
  const { data: qpiRows } = version ? await supabase.from("qpis").select("id, section_id, code, title, descriptor, applies_to, assurance_based, onsite, per_teacher, satisfied_by_ase, dual_scenario3_included, random_audit_kind, allows_na, sort").eq("version_id", version.id).order("sort") : { data: [] };
  const qpis = applicableQpis((qpiRows ?? []) as (QpiFlags & { id: string; descriptor: string; random_audit_kind: string | null })[], {
    isCoop: catalog?.is_coop ?? false, deliveryType: dp.delivery_type, dualScenario: dp.dual_scenario, aseAccredited: dp.ase_accredited,
  });

  let site: SiteInfo | null = null;
  if (typeof siteId === "string") {
    const [{ data: s }, { data: open }, { data: scores }] = await Promise.all([
      supabase.from("program_review_sites").select("id, director_submitted_at, director_submitted_by, scoring_extended_until, program_reviews(id, status, lea_review_id, lea_reviews(released_at, visit_start, visit_end, milestones(kind, computed_on, override_on)))").eq("id", siteId).maybeSingle(),
      supabase.rpc("self_scoring_open", { p_site: siteId }),
      supabase.from("current_scores").select("qpi_code, value, na_reason, comment, version, created_at, scorer_role").eq("site_id", siteId),
    ]);
    if (s) {
      const pr = s.program_reviews as unknown as { id: string; status: string; lea_review_id: string; lea_reviews: { released_at: string | null; visit_start: string | null; visit_end: string | null; milestones: { kind: string; computed_on: string | null; override_on: string | null }[] } | null } | null;
      const due = pr?.lea_reviews?.milestones.find((m) => m.kind === "evidence_due");
      site = {
        id: s.id, director_submitted_at: s.director_submitted_at, director_submitted_by: s.director_submitted_by, scoring_extended_until: s.scoring_extended_until,
        program_review_id: pr?.id ?? "", status: pr?.status ?? "", lea_review_id: pr?.lea_review_id ?? "", released_at: pr?.lea_reviews?.released_at ?? null,
        visit_start: pr?.lea_reviews?.visit_start ?? null, visit_end: pr?.lea_reviews?.visit_end ?? null, evidence_due: due?.override_on ?? due?.computed_on ?? null,
        open: open === true, scores: (scores ?? []) as ScoreRow[],
      };
    }
  }

  const isDirector = user.grants.some((g) => g.role === "cte_director" && g.lea_id === dp.lea_id);
  const manages = isDirector || user.grants.some((g) => g.role === "lea_staff" && g.lea_id === dp.lea_id);
  const isTeacher = user.roles.has("teacher") && user.leaIds.includes(dp.lea_id);
  const district = manages || isTeacher;
  return {
    dp, lea, year, catalog, school, teachers, siteId: typeof siteId === "string" ? siteId : null, version, files: files ?? [], credentials: credentials ?? [], form, rules: rules ?? [], qpis, site,
    roles: { isDirector, manages, isTeacher, district, staff: user.isStaff, admin: user.isStateAdmin, canUpload: district && dp.status === "active" },
  };
}

export type ProgramData = NonNullable<Awaited<ReturnType<typeof loadProgram>>>;
