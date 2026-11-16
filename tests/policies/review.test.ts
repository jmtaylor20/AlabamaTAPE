import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, asUser, denied, expectDenied, fails, pool, withRole } from "./harness";
import { instrumentSql } from "../../scripts/db/seed-instrument.mjs";

/**
 * Phase 4 tests: reviewer scoring is limited to assigned, unlocked sites; the
 * desk audit reaches the Director only when sent; finalization needs every
 * applicable indicator scored, a consistency meeting, and a fresh TOTP
 * verification; a finalized review rejects writes from everyone; reopening is
 * a logged State Admin action with a reason; findings come from reviewer 1s.
 */

let p: pg.Pool;
const ids = {
  leaA: "dddddddd-0000-4000-8000-00000000000a",
  schoolA: "dddddddd-0000-4000-8000-00000000001a",
  teacherA1: "dddddddd-0000-4000-8000-00000000002a",
  teacherA2: "dddddddd-0000-4000-8000-00000000003a",
  admin: "40000000-0000-4000-8000-000000000001",
  reviewer1: "40000000-0000-4000-8000-000000000002",
  reviewer2: "40000000-0000-4000-8000-000000000004",
  leadership: "40000000-0000-4000-8000-000000000003",
  directorA: "40000000-0000-4000-8000-00000000000a",
  teacherUserA1: "40000000-0000-4000-8000-00000000002a",
  teacherUserA2: "40000000-0000-4000-8000-00000000003a",
};
let yearId = "";
let reviewA = "";
let pr10 = "";
let site10 = "";
let dp10 = "";
const now = () => Math.floor(Date.now() / 1000);
const fresh = (sub: string) => ({ sub, amr: [{ method: "totp", timestamp: now() - 60 }] });
const stale = (sub: string) => ({ sub, amr: [{ method: "totp", timestamp: now() - 3600 }] });

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    yearId = (await c.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true) returning id")).rows[0].id;
    await c.query(`
      insert into public.clusters (code, name) values ('01', 'Agriculture');
      insert into public.program_catalog (code, name, cluster_code, is_coop) values ('10', 'General Agriculture', '01', false), ('11', 'Animal Science', '01', false);
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '905', 'Birch Valley County');
      insert into public.schools (id, lea_id, school_code, name) values ('${ids.schoolA}', '${ids.leaA}', '0030', 'Birch Valley High School');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'birchvalley.example.edu'), (null, 'state.example.gov');
      insert into public.teachers (id, lea_id, display_name, email) values ('${ids.teacherA1}', '${ids.leaA}', 'Quinn Marlowe', 'quinn.marlowe@birchvalley.example.edu'), ('${ids.teacherA2}', '${ids.leaA}', 'Ember Castellan', 'ember.castellan@birchvalley.example.edu');
      insert into public.invitations (email, role, lea_id, cluster_code, teacher_id) values
        ('admin@state.example.gov', 'state_admin', null, null, null), ('reviewer1@state.example.gov', 'reviewer', null, null, null), ('reviewer2@state.example.gov', 'reviewer', null, null, null),
        ('leader@state.example.gov', 'leadership', null, null, null), ('director@birchvalley.example.edu', 'cte_director', '${ids.leaA}', null, null),
        ('quinn.marlowe@birchvalley.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA1}'), ('ember.castellan@birchvalley.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA2}');
    `);
    for (const [id, email] of [[ids.admin, "admin@state.example.gov"], [ids.reviewer1, "reviewer1@state.example.gov"], [ids.reviewer2, "reviewer2@state.example.gov"], [ids.leadership, "leader@state.example.gov"], [ids.directorA, "director@birchvalley.example.edu"], [ids.teacherUserA1, "quinn.marlowe@birchvalley.example.edu"], [ids.teacherUserA2, "ember.castellan@birchvalley.example.edu"]])
      await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await c.query(instrumentSql());
    const cycleId = (await c.query("insert into public.review_cycles (school_year_id, name) values ($1, '2026-2027 TAPE') returning id", [yearId])).rows[0].id;
    dp10 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, ase_accredited) values ($1, $2, $3, '10', true) returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    const dp11 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '11') returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    await c.query("insert into public.declared_program_teachers (declared_program_id, teacher_id) values ($1, $2), ($3, $4)", [dp10, ids.teacherA1, dp11, ids.teacherA2]);
    reviewA = (await c.query("insert into public.lea_reviews (cycle_id, lea_id, review_month, review_year, visit_start, visit_end) values ($1, $2, 3, 2027, '2027-03-09', '2027-03-10') returning id", [cycleId, ids.leaA])).rows[0].id;
    await c.query("insert into public.selections (lea_review_id, declared_program_id, method) values ($1, $2, 'manual')", [reviewA, dp10]);
  });
  await asUser(p, { sub: ids.admin }, async (c) => {
    await c.query("select app.materialize_program_reviews($1)", [reviewA]);
    await c.query("insert into public.review_assignments (program_review_id, user_id, email, assignment_role, assigned_by) select id, $1, 'reviewer1@state.example.gov', 'lead_reviewer', $2 from public.program_reviews where lea_review_id = $3", [ids.reviewer1, ids.admin, reviewA]);
    await c.query("select app.release_notification($1)", [reviewA]);
    site10 = (await c.query("select app.site_for_declared_program($1) as id", [dp10])).rows[0].id;
    pr10 = (await c.query("select app.site_program_review($1) as id", [site10])).rows[0].id;
  });
});

afterAll(async () => {
  await asOwner(p, (c) =>
    c.query(`truncate public.audit_events, public.finalizations, public.findings, public.consistency_meetings, public.desk_audits, public.onsite_checks, public.audit_samples, public.section_comments, public.epic_scores,
      public.score_entries, public.credential_results, public.form_141_items, public.form_141, public.evidence_access, public.evidence_qpi_links, public.evidence_files,
      public.scope_changes, public.review_assignments, public.program_review_site_teachers, public.program_review_sites, public.program_reviews, public.selections, public.selection_draws,
      public.milestones, public.lea_reviews, public.declaration_revisions, public.declaration_windows, public.declared_program_teachers, public.declared_programs, public.declaration_imports, public.compliance_list, public.review_cycles, public.lea_contacts,
      public.checklist_items, public.scoring_rules, public.epic_descriptors, public.qpi_subitems, public.qpis, public.instrument_sections, public.instrument_versions,
      public.staff_pairings, public.invitations, public.teacher_years, public.teachers, public.role_grants, public.profiles, public.holidays, public.approved_domains, public.schools, public.leas, public.program_catalog, public.clusters, public.school_years, auth.users restart identity cascade`),
  );
  await p.end();
});

const score = (sub: string, qpi: string, value: string, comment?: string) =>
  `insert into public.score_entries (site_id, qpi_code, scorer_role, value, comment, author_id) values ('${site10}', '${qpi}', 'reviewer', '${value}', ${comment ? `'${comment}'` : "null"}, '${sub}')`;

describe("reviewer scoring and desk audit", () => {
  it("only an assigned reviewer scores as a reviewer; the Director cannot read reviewer scores before finalization", async () => {
    expect(site10).toBeTruthy();
    await expectDenied(withRole(p, { sub: ids.reviewer2 }, (c) => c.query(score(ids.reviewer2, "1.1.A", "2"))));
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query(score(ids.directorA, "1.1.A", "2"))));
    await expectDenied(withRole(p, { sub: ids.teacherUserA1 }, (c) => c.query(score(ids.teacherUserA1, "1.1.A", "2"))));
    await asUser(p, { sub: ids.reviewer1 }, (c) => c.query(score(ids.reviewer1, "1.1.A", "2")));
    const director = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select id from public.current_scores where scorer_role = 'reviewer'")).rowCount);
    const leader = await withRole(p, { sub: ids.leadership }, async (c) => (await c.query("select id from public.current_scores where scorer_role = 'reviewer'")).rowCount);
    expect(director).toBe(0);
    expect(leader).toBe(1);
  });

  it("the desk audit reaches the Director only when sent", async () => {
    await asUser(p, { sub: ids.reviewer1 }, (c) => c.query("insert into public.desk_audits (site_id, initial_findings, author_id) values ($1, 'No CTSO minutes in the evidence yet.', $2)", [site10, ids.reviewer1]));
    const before = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select id from public.desk_audits")).rowCount);
    expect(before).toBe(0);
    await expectDenied(withRole(p, { sub: ids.reviewer2 }, (c) => c.query("select app.send_desk_audit($1)", [site10])));
    await asUser(p, { sub: ids.reviewer1 }, (c) => c.query("select app.send_desk_audit($1)", [site10]));
    const after = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select initial_findings from public.desk_audits")).rows);
    expect(after).toEqual([{ initial_findings: "No CTSO minutes in the evidence yet." }]);
    const status = await asOwner(p, async (c) => (await c.query("select status::text as s from public.program_reviews where id = $1", [pr10])).rows[0].s);
    expect(status).toBe("desk_audit");
  });

  it("audit samples and onsite checks are written by the assigned reviewer and hidden from the district until finalization", async () => {
    await asUser(p, { sub: ids.reviewer1 }, async (c) => {
      await c.query("insert into public.audit_samples (site_id, qpi_code, kind, items_sampled, items_passed, author_id) values ($1, '2.1.A', 'assurance', 5, 4, $2)", [site10, ids.reviewer1]);
      const sub = (await c.query("select s.id from public.qpi_subitems s join public.qpis q on q.id = s.qpi_id where q.code = '2.1.G' order by s.sort limit 1")).rows[0].id;
      await c.query("insert into public.onsite_checks (site_id, subitem_id, state, author_id) values ($1, $2, 'met', $3) on conflict (site_id, subitem_id) do update set state = excluded.state, synced_at = now()", [site10, sub, ids.reviewer1]);
    });
    await expectDenied(withRole(p, { sub: ids.reviewer2 }, (c) => c.query("insert into public.audit_samples (site_id, qpi_code, kind, items_sampled, items_passed, author_id) values ($1, '2.1.A', 'assurance', 5, 4, $2)", [site10, ids.reviewer2])));
    const district = await withRole(p, { sub: ids.directorA }, async (c) => ({ samples: (await c.query("select id from public.audit_samples")).rowCount, checks: (await c.query("select site_id from public.onsite_checks")).rowCount }));
    expect(district).toEqual({ samples: 0, checks: 0 });
  });
});

describe("finalization", () => {
  it("fails until every applicable indicator has a reviewer score, a consistency meeting exists, and MFA is fresh", async () => {
    await withRole(p, fresh(ids.reviewer1), async (c) => {
      await fails(c, "select app.finalize_program_review($1)", [pr10], /reviewer score missing/);
    });
    // ASE-accredited: the ASE-satisfied indicators are not required. Score everything else, with a 1 on 1.1.C.
    await asUser(p, { sub: ids.reviewer1 }, async (c) => {
      const codes = (await c.query("select code from app.applicable_qpi_codes($1) code", [site10])).rows.map((r) => r.code as string);
      expect(codes).not.toContain("3.1.A");
      expect(codes).toContain("2.1.F");
      for (const code of codes) if (code !== "1.1.A") await c.query(score(ids.reviewer1, code, code === "1.1.C" ? "1" : "2", code === "1.1.C" ? "Fewer than four meetings in the last twelve months." : undefined));
    });
    await withRole(p, fresh(ids.reviewer1), async (c) => {
      await fails(c, "select app.finalize_program_review($1)", [pr10], /consistency meeting/);
    });
    await expectDenied(withRole(p, { sub: ids.reviewer2 }, (c) => c.query("insert into public.consistency_meetings (lea_review_id, held_on, attendees, recorded_by) values ($1, '2027-03-12', 'Reviewer 1, Cluster Admin', $2)", [reviewA, ids.reviewer2])));
    await asUser(p, { sub: ids.reviewer1 }, (c) => c.query("insert into public.consistency_meetings (lea_review_id, held_on, attendees, recorded_by) values ($1, '2027-03-12', 'Reviewer 1, Cluster Admin', $2)", [reviewA, ids.reviewer1]));
    await withRole(p, stale(ids.reviewer1), async (c) => {
      await fails(c, "select app.finalize_program_review($1)", [pr10], /authenticator/);
    });
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      await fails(c, "select app.finalize_program_review($1)", [pr10], /authenticator/);
    });
    await expectDenied(withRole(p, fresh(ids.reviewer2), (c) => c.query("select app.finalize_program_review($1)", [pr10])));
    await expectDenied(withRole(p, fresh(ids.directorA), (c) => c.query("select app.finalize_program_review($1)", [pr10])));
  });

  it("succeeds with a fresh verification, creates findings from the 1s, and locks the review for everyone", async () => {
    await asUser(p, fresh(ids.reviewer1), (c) => c.query("select app.finalize_program_review($1)", [pr10]));
    const state = await asOwner(p, async (c) => ({
      review: (await c.query("select status::text as s, finalized_by from public.program_reviews where id = $1", [pr10])).rows[0],
      findings: (await c.query("select qpi_code, body, status from public.findings where site_id = $1 order by qpi_code", [site10])).rows,
      finalization: (await c.query("select kind, step_up_verified_at is not null as stepped, consistency_meeting_id is not null as met from public.finalizations where program_review_id = $1", [pr10])).rows,
      logged: (await c.query("select count(*)::int as n from public.audit_events where action = 'program_review.finalized' and entity_id = $1", [pr10])).rows[0].n,
    }));
    expect(state.review).toEqual({ s: "finalized", finalized_by: ids.reviewer1 });
    expect(state.findings).toEqual([{ qpi_code: "1.1.C", body: "Fewer than four meetings in the last twelve months.", status: "open" }]);
    expect(state.finalization).toEqual([{ kind: "finalized", stepped: true, met: true }]);
    expect(state.logged).toBe(1);
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query(score(ids.reviewer1, "1.1.A", "1"))));
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query(score(ids.admin, "1.1.A", "1"))));
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      expect((await c.query("update public.findings set body = 'changed' where site_id = $1", [site10])).rowCount).toBe(0);
      expect((await c.query("update public.desk_audits set initial_findings = 'changed' where site_id = $1", [site10])).rowCount).toBe(0);
      await denied(c, "insert into public.audit_samples (site_id, qpi_code, kind, items_sampled, items_passed, author_id) values ($1, '2.1.B', 'assurance', 3, 3, $2)", [site10, ids.reviewer1]);
    });
    await withRole(p, fresh(ids.reviewer1), async (c) => {
      await fails(c, "select app.finalize_program_review($1)", [pr10], /already finalized/);
    });
  });

  it("after finalization the Director and the program's teacher read scores and findings; another teacher does not", async () => {
    const director = await withRole(p, { sub: ids.directorA }, async (c) => ({
      scores: (await c.query("select id from public.current_scores where scorer_role = 'reviewer'")).rowCount,
      findings: (await c.query("select qpi_code from public.findings")).rows.map((r) => r.qpi_code),
      samples: (await c.query("select items_sampled, items_passed from public.audit_samples")).rows,
    }));
    expect(director.scores).toBeGreaterThan(10);
    expect(director.findings).toEqual(["1.1.C"]);
    expect(director.samples).toEqual([{ items_sampled: 5, items_passed: 4 }]);
    const teacher = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => ({ findings: (await c.query("select id from public.findings")).rowCount, scores: (await c.query("select id from public.current_scores")).rowCount }));
    const other = await withRole(p, { sub: ids.teacherUserA2 }, async (c) => (await c.query("select id from public.findings")).rowCount);
    const leader = await withRole(p, { sub: ids.leadership }, async (c) => (await c.query("select id from public.findings")).rowCount);
    expect(teacher).toEqual({ findings: 1, scores: 0 });
    expect(other).toBe(0);
    expect(leader).toBe(0);
  });

  it("only the State Admin reopens, with a reason, and the reopening is logged and visible as a scope change", async () => {
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query("select app.reopen_program_review($1, 'late evidence')", [pr10])));
    await withRole(p, { sub: ids.admin }, async (c) => {
      await fails(c, "select app.reopen_program_review($1, '')", [pr10], /reason/);
    });
    await asUser(p, { sub: ids.admin }, (c) => c.query("select app.reopen_program_review($1, 'Director sent the missing minutes on day eight')", [pr10]));
    const state = await asOwner(p, async (c) => ({
      review: (await c.query("select status::text as s, finalized_at from public.program_reviews where id = $1", [pr10])).rows[0],
      kinds: (await c.query("select kind from public.finalizations where program_review_id = $1 order by id", [pr10])).rows.map((r) => r.kind),
      scope: (await c.query("select kind, reason from public.scope_changes where lea_review_id = $1", [reviewA])).rows,
    }));
    expect(state.review).toEqual({ s: "post_visit", finalized_at: null });
    expect(state.kinds).toEqual(["finalized", "reopened"]);
    expect(state.scope).toEqual([{ kind: "reopened", reason: "Director sent the missing minutes on day eight" }]);
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      const finding = (await c.query("select id from public.findings where site_id = $1", [site10])).rows[0].id;
      await c.query("select app.clear_finding($1, 'Minutes for four meetings received', null)", [finding]);
      expect((await c.query("select status, cleared_by from public.findings where id = $1", [finding])).rows[0]).toEqual({ status: "cleared", cleared_by: ids.reviewer1 });
      expect((await c.query(score(ids.reviewer1, "1.1.C", "2", "Minutes received"))).rowCount).toBe(1);
    });
    const directorNow = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select id from public.current_scores where scorer_role = 'reviewer'")).rowCount);
    expect(directorNow).toBe(0);
  });
});
