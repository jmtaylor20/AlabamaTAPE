import "server-only";
import type { CurrentUser } from "@/lib/auth/session";
import { applicableQpis, type QpiFlags } from "@/lib/instrument/applicability";
import { createUserClient } from "@/lib/supabase/server";

export type ScoreRow = { qpi_code: string; value: string; na_reason: string | null; comment: string | null; version: number; created_at: string; scorer_role: string };
export type Finding = { id: string; qpi_code: string; teacher_id: string | null; body: string; status: string; cleared_at: string | null; clearing_note: string | null; created_at: string };
export type AuditSample = { id: string; qpi_code: string; kind: string; items_sampled: number; items_passed: number; notes: string | null; created_at: string };
export type OnsiteCheck = { subitem_id: string; state: string; note: string | null; captured_at: string };
export type EpicScoreRow = { descriptor_id: string; value: string; na_reason: string | null; comment: string | null; version: number };
export type SectionComment = { section_code: string; author_role: string; body: string };
export type PipGoal = { id: string; finding_id: string | null; qpi_code: string; action_steps: string; status: string | null; date_accomplished: string | null; sort: number };
export type PipInfo = {
  id: string; status: string; ten_day_close: string; starts_on: string; due_on: string; created_at: string; closed_at: string | null; close_note: string | null;
  goals: PipGoal[]; progress: { month: number; body: string; progress_lacking: boolean; entered_at: string }[];
  notes: { id: string; goal_id: string | null; author_role: string; body: string; evidence_file_id: string | null; created_at: string; author: string | null }[];
  escalations: { month: number; open_goals: number; notified: string[]; notified_at: string }[];
};
export type SiteInfo = {
  id: string; director_submitted_at: string | null; director_submitted_by: string | null; scoring_extended_until: string | null; program_review_id: string; status: string; lea_review_id: string;
  released_at: string | null; visit_start: string | null; visit_end: string | null; evidence_due: string | null; open: boolean; scores: ScoreRow[];
  epic: boolean; finalized_at: string | null; finalized_by: string | null; locked: boolean; reviewers: { display_name: string | null; email: string; assignment_role: string }[];
  deskAudit: { id: string; initial_findings: string | null; sent_at: string | null } | null; findings: Finding[]; samples: AuditSample[]; checks: OnsiteCheck[]; epicScores: EpicScoreRow[]; comments: SectionComment[];
  meetings: { id: string; held_on: string; attendees: string; notes: string | null }[]; finalizations: { kind: string; reason: string | null; created_at: string; actor_id: string }[]; applicableCodes: string[];
  pip: PipInfo | null;
};

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
  const [{ data: qpiRows }, { data: sections }, { data: subitems }, { data: descriptors }] = version
    ? await Promise.all([
        supabase.from("qpis").select("id, section_id, code, title, descriptor, applies_to, assurance_based, onsite, per_teacher, satisfied_by_ase, dual_scenario3_included, random_audit_kind, allows_na, sort").eq("version_id", version.id).order("sort"),
        supabase.from("instrument_sections").select("id, code, title, sort").eq("version_id", version.id).order("sort"),
        supabase.from("qpi_subitems").select("id, qpi_id, text, allows_na, sort").order("sort"),
        supabase.from("epic_descriptors").select("id, section_id, text, sort").eq("version_id", version.id).order("sort"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const qpis = applicableQpis((qpiRows ?? []) as (QpiFlags & { id: string; descriptor: string; random_audit_kind: string | null })[], {
    isCoop: catalog?.is_coop ?? false, deliveryType: dp.delivery_type, dualScenario: dp.dual_scenario, aseAccredited: dp.ase_accredited,
  });

  let site: SiteInfo | null = null;
  if (typeof siteId === "string") {
    const [{ data: s }, { data: open }, { data: scores }, { data: deskAudit }, { data: findings }, { data: samples }, { data: checks }, { data: epicScores }, { data: comments }, { data: codes }] = await Promise.all([
      supabase.from("program_review_sites").select("id, director_submitted_at, director_submitted_by, scoring_extended_until, program_reviews(id, status, epic, finalized_at, finalized_by, lea_review_id, lea_reviews(released_at, visit_start, visit_end, milestones(kind, computed_on, override_on), consistency_meetings(id, held_on, attendees, notes)), review_assignments(display_name, email, assignment_role, revoked_at), finalizations(kind, reason, created_at, actor_id))").eq("id", siteId).maybeSingle(),
      supabase.rpc("self_scoring_open", { p_site: siteId }),
      supabase.from("current_scores").select("qpi_code, value, na_reason, comment, version, created_at, scorer_role").eq("site_id", siteId),
      supabase.from("desk_audits").select("id, initial_findings, sent_at").eq("site_id", siteId).maybeSingle(),
      supabase.from("findings").select("id, qpi_code, teacher_id, body, status, cleared_at, clearing_note, created_at").eq("site_id", siteId).order("qpi_code"),
      supabase.from("audit_samples").select("id, qpi_code, kind, items_sampled, items_passed, notes, created_at").eq("site_id", siteId).order("created_at"),
      supabase.from("onsite_checks").select("subitem_id, state, note, captured_at").eq("site_id", siteId),
      supabase.from("current_epic_scores").select("descriptor_id, value, na_reason, comment, version").eq("site_id", siteId),
      supabase.from("section_comments").select("section_code, author_role, body").eq("site_id", siteId),
      supabase.rpc("applicable_qpi_codes", { p_site: siteId }),
    ]);
    if (s) {
      type PR = { id: string; status: string; epic: boolean; finalized_at: string | null; finalized_by: string | null; lea_review_id: string; lea_reviews: { released_at: string | null; visit_start: string | null; visit_end: string | null; milestones: { kind: string; computed_on: string | null; override_on: string | null }[]; consistency_meetings: { id: string; held_on: string; attendees: string; notes: string | null }[] } | null; review_assignments: { display_name: string | null; email: string; assignment_role: string; revoked_at: string | null }[]; finalizations: { kind: string; reason: string | null; created_at: string; actor_id: string }[] };
      const pr = s.program_reviews as unknown as PR | null;
      const due = pr?.lea_reviews?.milestones.find((m) => m.kind === "evidence_due");
      site = {
        id: s.id, director_submitted_at: s.director_submitted_at, director_submitted_by: s.director_submitted_by, scoring_extended_until: s.scoring_extended_until,
        program_review_id: pr?.id ?? "", status: pr?.status ?? "", lea_review_id: pr?.lea_review_id ?? "", released_at: pr?.lea_reviews?.released_at ?? null,
        visit_start: pr?.lea_reviews?.visit_start ?? null, visit_end: pr?.lea_reviews?.visit_end ?? null, evidence_due: due?.override_on ?? due?.computed_on ?? null,
        open: open === true, scores: (scores ?? []) as ScoreRow[],
        epic: pr?.epic ?? false, finalized_at: pr?.finalized_at ?? null, finalized_by: pr?.finalized_by ?? null, locked: !!pr?.finalized_at,
        reviewers: (pr?.review_assignments ?? []).filter((a) => !a.revoked_at).map((a) => ({ display_name: a.display_name, email: a.email, assignment_role: a.assignment_role })),
        deskAudit: deskAudit ?? null, findings: (findings ?? []) as Finding[], samples: (samples ?? []) as AuditSample[], checks: (checks ?? []) as OnsiteCheck[], epicScores: (epicScores ?? []) as EpicScoreRow[], comments: (comments ?? []) as SectionComment[],
        meetings: pr?.lea_reviews?.consistency_meetings ?? [], finalizations: (pr?.finalizations ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at)), applicableCodes: ((codes ?? []) as unknown as string[]),
        pip: null,
      };
      if (pr?.id) {
        const { data: pip } = await supabase.from("pips").select("id, status, ten_day_close, starts_on, due_on, created_at, closed_at, close_note, pip_goals(id, finding_id, qpi_code, action_steps, status, date_accomplished, sort), pip_progress(month, body, progress_lacking, entered_at), pip_notes(id, goal_id, author_role, body, evidence_file_id, created_at, profiles!pip_notes_author_id_fkey(display_name)), pip_escalations(month, open_goals, notified, notified_at)").eq("program_review_id", pr.id).maybeSingle();
        if (pip) {
          site.pip = {
            id: pip.id, status: pip.status, ten_day_close: pip.ten_day_close, starts_on: pip.starts_on, due_on: pip.due_on, created_at: pip.created_at, closed_at: pip.closed_at, close_note: pip.close_note,
            goals: ((pip.pip_goals as unknown as PipGoal[]) ?? []).sort((a, b) => a.sort - b.sort),
            progress: ((pip.pip_progress as unknown as PipInfo["progress"]) ?? []).sort((a, b) => a.month - b.month),
            notes: ((pip.pip_notes as unknown as { id: string; goal_id: string | null; author_role: string; body: string; evidence_file_id: string | null; created_at: string; profiles: { display_name: string } | null }[]) ?? []).map((n) => ({ ...n, author: n.profiles?.display_name ?? null })).sort((a, b) => a.created_at.localeCompare(b.created_at)),
            escalations: ((pip.pip_escalations as unknown as { month: number; open_goals: number; notified: string[]; notified_at: string }[]) ?? []).sort((a, b) => a.month - b.month),
          };
        }
      }
    }
  }

  const qpiIds = new Set(qpis.map((q) => q.id));
  const isDirector = user.grants.some((g) => g.role === "cte_director" && g.lea_id === dp.lea_id);
  const manages = isDirector || user.grants.some((g) => g.role === "lea_staff" && g.lea_id === dp.lea_id);
  const isTeacher = user.roles.has("teacher") && user.leaIds.includes(dp.lea_id);
  const district = manages || isTeacher;
  return {
    dp, lea, year, catalog, school, teachers, siteId: typeof siteId === "string" ? siteId : null, version, files: files ?? [], credentials: credentials ?? [], form, rules: rules ?? [], qpis, site,
    sections: sections ?? [], subitems: (subitems ?? []).filter((x) => qpiIds.has(x.qpi_id)), descriptors: descriptors ?? [],
    roles: { isDirector, manages, isTeacher, district, staff: user.isStaff, admin: user.isStateAdmin, canUpload: district && dp.status === "active", isReviewer: !!site && site.reviewers.some((r) => r.email === user.email) },
  };
}

export type ProgramData = NonNullable<Awaited<ReturnType<typeof loadProgram>>>;
