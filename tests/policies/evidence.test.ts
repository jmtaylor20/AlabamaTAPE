import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, asUser, denied, expectDenied, fails, pool, withRole } from "./harness";
import { instrumentSql } from "../../scripts/db/seed-instrument.mjs";

/**
 * Phase 3 tests: evidence scoping by LEA, program, assignment, and cluster;
 * unscanned, infected, quarantined, and removed files cannot be linked to;
 * Director self-scores are insert-only, versioned, gated by release and
 * submission; Form 14-1 and credential results follow the same scopes.
 */

let p: pg.Pool;
const ids = {
  leaA: "cccccccc-0000-4000-8000-00000000000a",
  leaB: "cccccccc-0000-4000-8000-00000000000b",
  schoolA: "cccccccc-0000-4000-8000-00000000001a",
  schoolB: "cccccccc-0000-4000-8000-00000000001b",
  teacherA1: "cccccccc-0000-4000-8000-00000000002a",
  teacherA2: "cccccccc-0000-4000-8000-00000000003a",
  admin: "30000000-0000-4000-8000-000000000001",
  reviewer1: "30000000-0000-4000-8000-000000000002",
  reviewer2: "30000000-0000-4000-8000-000000000004",
  clusterAdmin: "30000000-0000-4000-8000-000000000005",
  leadership: "30000000-0000-4000-8000-000000000003",
  directorA: "30000000-0000-4000-8000-00000000000a",
  staffA: "30000000-0000-4000-8000-00000000001a",
  directorB: "30000000-0000-4000-8000-00000000000b",
  teacherUserA1: "30000000-0000-4000-8000-00000000002a",
  teacherUserA2: "30000000-0000-4000-8000-00000000003a",
};
let yearId = "";
let reviewA = "";
let dp10 = "";
let dp11 = "";
let site10 = "";
let fileId = "";

const claims = (sub: string) => ({ sub });

const asAdmin = (fn: (c: pg.PoolClient) => Promise<unknown>) => asUser(p, { sub: ids.admin }, fn);

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    yearId = (await c.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true) returning id")).rows[0].id;
    await c.query(`
      insert into public.clusters (code, name) values ('01', 'Agriculture'), ('02', 'Construction');
      insert into public.program_catalog (code, name, cluster_code, is_coop) values ('10', 'General Agriculture', '01', false), ('11', 'Welding', '02', false);
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '903', 'Cedar Hollow County'), ('${ids.leaB}', '904', 'Maple Bend City');
      insert into public.schools (id, lea_id, school_code, name) values ('${ids.schoolA}', '${ids.leaA}', '0020', 'Cedar Hollow High School'), ('${ids.schoolB}', '${ids.leaB}', '0020', 'Maple Bend High School');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'cedarhollow.example.edu'), ('${ids.leaB}', 'maplebend.example.edu'), (null, 'state.example.gov');
      insert into public.teachers (id, lea_id, display_name, email) values ('${ids.teacherA1}', '${ids.leaA}', 'Rowan Ellery', 'rowan.ellery@cedarhollow.example.edu'), ('${ids.teacherA2}', '${ids.leaA}', 'Sage Whitfield', 'sage.whitfield@cedarhollow.example.edu');
      insert into public.invitations (email, role, lea_id, cluster_code, teacher_id) values
        ('admin@state.example.gov', 'state_admin', null, null, null),
        ('reviewer1@state.example.gov', 'reviewer', null, null, null),
        ('reviewer2@state.example.gov', 'reviewer', null, null, null),
        ('cluster@state.example.gov', 'cluster_admin', null, '01', null),
        ('leader@state.example.gov', 'leadership', null, null, null),
        ('director@cedarhollow.example.edu', 'cte_director', '${ids.leaA}', null, null),
        ('staff@cedarhollow.example.edu', 'lea_staff', '${ids.leaA}', null, null),
        ('rowan.ellery@cedarhollow.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA1}'),
        ('sage.whitfield@cedarhollow.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA2}'),
        ('director@maplebend.example.edu', 'cte_director', '${ids.leaB}', null, null);
    `);
    for (const [id, email] of [
      [ids.admin, "admin@state.example.gov"], [ids.reviewer1, "reviewer1@state.example.gov"], [ids.reviewer2, "reviewer2@state.example.gov"], [ids.clusterAdmin, "cluster@state.example.gov"],
      [ids.leadership, "leader@state.example.gov"], [ids.directorA, "director@cedarhollow.example.edu"], [ids.staffA, "staff@cedarhollow.example.edu"],
      [ids.teacherUserA1, "rowan.ellery@cedarhollow.example.edu"], [ids.teacherUserA2, "sage.whitfield@cedarhollow.example.edu"], [ids.directorB, "director@maplebend.example.edu"],
    ]) await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await c.query(instrumentSql());
    const cycleId = (await c.query("insert into public.review_cycles (school_year_id, name, settings) values ($1, '2026-2027 TAPE', '{\"january_evidence_due\": \"2027-01-04\"}') returning id", [yearId])).rows[0].id;
    dp10 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '10') returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    dp11 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '11') returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    await c.query("insert into public.declared_program_teachers (declared_program_id, teacher_id) values ($1, $2), ($3, $4)", [dp10, ids.teacherA1, dp11, ids.teacherA2]);
    await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '10')", [ids.leaB, yearId, ids.schoolB]);
    reviewA = (await c.query("insert into public.lea_reviews (cycle_id, lea_id, review_month, review_year, visit_start, visit_end) values ($1, $2, 1, 2027, '2027-01-19', '2027-01-21') returning id", [cycleId, ids.leaA])).rows[0].id;
    await c.query("insert into public.selections (lea_review_id, declared_program_id, method) values ($1, $2, 'manual')", [reviewA, dp10]);
  });
  await asAdmin(async (c) => {
    await c.query("select app.materialize_program_reviews($1)", [reviewA]);
    await c.query("insert into public.review_assignments (program_review_id, user_id, email, assignment_role, assigned_by) select id, $1, 'reviewer1@state.example.gov', 'lead_reviewer', $2 from public.program_reviews where lea_review_id = $3", [ids.reviewer1, ids.admin, reviewA]);
    await c.query("select app.release_notification($1)", [reviewA]);
    site10 = (await c.query("select app.site_for_declared_program($1) as id", [dp10])).rows[0].id;
  });
});

afterAll(async () => {
  await asOwner(p, (c) =>
    c.query(`truncate public.audit_events, public.score_entries, public.credential_results, public.form_141_items, public.form_141, public.evidence_access, public.evidence_qpi_links, public.evidence_files,
      public.scope_changes, public.review_assignments, public.program_review_site_teachers, public.program_review_sites, public.program_reviews, public.selections, public.selection_draws,
      public.milestones, public.lea_reviews, public.declaration_revisions, public.declaration_windows, public.declared_program_teachers, public.declared_programs, public.declaration_imports, public.compliance_list, public.review_cycles, public.lea_contacts,
      public.checklist_items, public.scoring_rules, public.epic_descriptors, public.qpi_subitems, public.qpis, public.instrument_sections, public.instrument_versions,
      public.staff_pairings, public.invitations, public.teacher_years, public.teachers, public.role_grants, public.profiles, public.holidays, public.approved_domains, public.schools, public.leas, public.program_catalog, public.clusters, public.school_years, auth.users restart identity cascade`),
  );
  await p.end();
});

function fileRow(dp: string, lea: string, program: string, by: string, key: string) {
  return `insert into public.evidence_files (lea_id, school_year_id, declared_program_id, program_code, school_id, storage_key, original_name, content_type, size_bytes, uploaded_by)
    values ('${lea}', '${yearId}', '${dp}', '${program}', null, '${key}', 'fabricated-evidence.pdf', 'application/pdf', 1024, '${by}') returning id`;
}

describe("evidence files", () => {
  it("the Director uploads for their own LEA; a Director elsewhere and a teacher on another program read nothing", async () => {
    expect(site10).toBeTruthy();
    await asUser(p, claims(ids.directorA), async (c) => {
      fileId = (await c.query(fileRow(dp10, ids.leaA, "10", ids.directorA, "lea/903/f1.pdf"))).rows[0].id;
      await c.query("insert into public.evidence_qpi_links (file_id, qpi_code, created_by) values ($1, '1.1.A', $2), ($1, '1.1.C', $2)", [fileId, ids.directorA]);
    });
    const other = await withRole(p, claims(ids.directorB), async (c) => (await c.query("select id from public.evidence_files")).rowCount);
    const teacherOnProgram = await withRole(p, claims(ids.teacherUserA1), async (c) => (await c.query("select id from public.evidence_files")).rowCount);
    const teacherElsewhere = await withRole(p, claims(ids.teacherUserA2), async (c) => ({
      files: (await c.query("select id from public.evidence_files")).rowCount,
      links: (await c.query("select file_id from public.evidence_qpi_links")).rowCount,
    }));
    const staff = await withRole(p, claims(ids.staffA), async (c) => (await c.query("select id from public.evidence_files")).rowCount);
    expect(other).toBe(0);
    expect(teacherOnProgram).toBe(1);
    expect(teacherElsewhere).toEqual({ files: 0, links: 0 });
    expect(staff).toBe(1);
  });

  it("a teacher uploads only to their own program and cannot upload as someone else", async () => {
    await asUser(p, claims(ids.teacherUserA1), async (c) => {
      const ok = await c.query(fileRow(dp10, ids.leaA, "10", ids.teacherUserA1, "lea/903/t1.pdf"));
      expect(ok.rowCount).toBe(1);
    });
    await expectDenied(withRole(p, claims(ids.teacherUserA1), (c) => c.query(fileRow(dp11, ids.leaA, "11", ids.teacherUserA1, "lea/903/t2.pdf"))));
    await expectDenied(withRole(p, claims(ids.teacherUserA1), (c) => c.query(fileRow(dp10, ids.leaA, "10", ids.directorA, "lea/903/t3.pdf"))));
    await expectDenied(withRole(p, claims(ids.directorB), (c) => c.query(fileRow(dp10, ids.leaA, "10", ids.directorB, "lea/903/x.pdf"))));
    await expectDenied(withRole(p, claims(ids.reviewer1), (c) => c.query(fileRow(dp10, ids.leaA, "10", ids.reviewer1, "lea/903/r.pdf"))));
  });

  it("no signed link until the scan is clean; never for an infected file", async () => {
    const access = (sub: string) => withRole(p, claims(sub), (c) => c.query("insert into public.evidence_access (file_id, user_id, purpose, expires_at) values ($1, $2, 'view', now() + interval '60 seconds')", [fileId, sub]));
    await expectDenied(access(ids.directorA));
    await asOwner(p, (c) => c.query("update public.evidence_files set scan_status = 'infected' where id = $1", [fileId]));
    await expectDenied(access(ids.directorA));
    await expectDenied(access(ids.admin));
    await asOwner(p, (c) => c.query("update public.evidence_files set scan_status = 'clean' where id = $1", [fileId]));
    await access(ids.directorA);
    await access(ids.teacherUserA1);
    await expectDenied(access(ids.teacherUserA2));
    await expectDenied(access(ids.directorB));
  });

  it("staff scope: assigned reviewer and cluster admin read; unassigned reviewer and leadership do not", async () => {
    const count = (sub: string) => withRole(p, claims(sub), async (c) => (await c.query("select id from public.evidence_files")).rowCount);
    expect(await count(ids.reviewer1)).toBe(2);
    expect(await count(ids.clusterAdmin)).toBe(2);
    expect(await count(ids.reviewer2)).toBe(0);
    expect(await count(ids.leadership)).toBe(0);
    expect(await count(ids.admin)).toBe(2);
  });

  it("quarantine hides a file from district roles and blocks links; only the State Admin lifts it", async () => {
    await expectDenied(withRole(p, claims(ids.reviewer2), (c) => c.query("select app.quarantine_evidence($1, 'suspicious')", [fileId])));
    await expectDenied(withRole(p, claims(ids.directorA), (c) => c.query("select app.quarantine_evidence($1, 'suspicious')", [fileId])));
    await asUser(p, claims(ids.reviewer1), (c) => c.query("select app.quarantine_evidence($1, 'contains a student roster')", [fileId]));
    const director = await withRole(p, claims(ids.directorA), async (c) => (await c.query("select id from public.evidence_files where id = $1", [fileId])).rowCount);
    const teacher = await withRole(p, claims(ids.teacherUserA1), async (c) => (await c.query("select id from public.evidence_files where id = $1", [fileId])).rowCount);
    const admin = await withRole(p, claims(ids.admin), async (c) => (await c.query("select quarantined, quarantine_reason from public.evidence_files where id = $1", [fileId])).rows[0]);
    expect(director).toBe(0);
    expect(teacher).toBe(0);
    expect(admin).toEqual({ quarantined: true, quarantine_reason: "contains a student roster" });
    await expectDenied(withRole(p, claims(ids.directorA), (c) => c.query("insert into public.evidence_access (file_id, user_id, expires_at) values ($1, $2, now() + interval '60 seconds')", [fileId, ids.directorA])));
    await expectDenied(withRole(p, claims(ids.reviewer1), (c) => c.query("insert into public.evidence_access (file_id, user_id, expires_at) values ($1, $2, now() + interval '60 seconds')", [fileId, ids.reviewer1])));
    await expectDenied(withRole(p, claims(ids.reviewer1), (c) => c.query("select app.release_quarantine($1, 'checked')", [fileId])));
    await asAdmin((c) => c.query("select app.release_quarantine($1, 'checked, no student data')", [fileId]));
    const again = await withRole(p, claims(ids.directorA), async (c) => (await c.query("select id from public.evidence_files where id = $1", [fileId])).rowCount);
    expect(again).toBe(1);
    const logged = await asOwner(p, async (c) => (await c.query("select action from public.audit_events where entity_id = $1 and action like 'evidence.%' order by id", [fileId])).rows.map((r) => r.action));
    expect(logged).toEqual(["evidence.quarantined", "evidence.quarantine_released"]);
  });

  it("removed files vanish for everyone but the State Admin and cannot be linked to", async () => {
    const teacherFile = await asOwner(p, async (c) => (await c.query("select id from public.evidence_files where storage_key = 'lea/903/t1.pdf'")).rows[0].id);
    await expectDenied(withRole(p, claims(ids.teacherUserA2), (c) => c.query("select app.remove_evidence($1, null)", [teacherFile])));
    await withRole(p, claims(ids.teacherUserA1), (c) => c.query("select app.remove_evidence($1, 'duplicate')", [teacherFile]));
    // Rolled back by withRole; do it for real as the Director (manages the LEA).
    await asUser(p, claims(ids.directorA), (c) => c.query("select app.remove_evidence($1, 'duplicate')", [teacherFile]));
    const director = await withRole(p, claims(ids.directorA), async (c) => (await c.query("select id from public.evidence_files where id = $1", [teacherFile])).rowCount);
    const admin = await withRole(p, claims(ids.admin), async (c) => (await c.query("select removed_at from public.evidence_files where id = $1", [teacherFile])).rows[0]);
    expect(director).toBe(0);
    expect(admin.removed_at).not.toBeNull();
    await expectDenied(withRole(p, claims(ids.admin), (c) => c.query("insert into public.evidence_access (file_id, user_id, expires_at) values ($1, $2, now() + interval '60 seconds')", [teacherFile, ids.admin])));
  });
});

describe("director self-scores", () => {
  const score = (sub: string, qpi: string, value: string, extra: Record<string, string> = {}) =>
    `insert into public.score_entries (site_id, qpi_code, scorer_role, value, na_reason, comment, author_id) values ('${site10}', '${qpi}', 'director', '${value}', ${extra.na ? `'${extra.na}'` : "null"}, ${extra.comment ? `'${extra.comment}'` : "null"}, '${sub}')`;

  it("only the Director scores, entries are insert-only and versioned, and N/A needs a reason", async () => {
    await expectDenied(withRole(p, claims(ids.teacherUserA1), (c) => c.query(score(ids.teacherUserA1, "2.1.A", "2"))));
    await expectDenied(withRole(p, claims(ids.staffA), (c) => c.query(score(ids.staffA, "2.1.A", "2"))));
    await expectDenied(withRole(p, claims(ids.directorB), (c) => c.query(score(ids.directorB, "2.1.A", "2"))));
    await withRole(p, claims(ids.directorA), async (c) => {
      await denied(c, score(ids.directorA, "2.1.A", "2").replace(`'${ids.directorA}')`, `'${ids.staffA}')`));
      await c.query(score(ids.directorA, "2.1.A", "1"));
      await c.query(score(ids.directorA, "2.1.A", "2", { comment: "syllabi observed" }));
      const versions = (await c.query("select version, value::text as v from public.score_entries where qpi_code = '2.1.A' order by version")).rows;
      expect(versions).toEqual([{ version: 1, v: "1" }, { version: 2, v: "2" }]);
      const current = (await c.query("select value::text as v, version from public.current_scores where qpi_code = '2.1.A' and scorer_role = 'director'")).rows;
      expect(current).toEqual([{ v: "2", version: 2 }]);
      await denied(c, "update public.score_entries set value = '1' where qpi_code = '2.1.A'");
      await denied(c, "delete from public.score_entries where qpi_code = '2.1.A'");
      await fails(c, score(ids.directorA, "3.1.E", "NA"), [], /check constraint/);
    });
  });

  it("submission needs a 1 or 2 on 2.1.A to D, then freezes scores until the State Admin reopens", async () => {
    await asUser(p, claims(ids.directorA), async (c) => {
      await c.query(score(ids.directorA, "2.1.A", "2"));
      await c.query(score(ids.directorA, "2.1.B", "2"));
      await c.query(score(ids.directorA, "2.1.C", "1"));
      await expect(c.query("select app.submit_director_scores($1)", [site10])).rejects.toThrow(/2\.1\.D/);
      await c.query(score(ids.directorA, "2.1.D", "2"));
    });
    await expectDenied(withRole(p, claims(ids.staffA), (c) => c.query("select app.submit_director_scores($1)", [site10])));
    await asUser(p, claims(ids.directorA), (c) => c.query("select app.submit_director_scores($1)", [site10]));
    await expectDenied(withRole(p, claims(ids.directorA), (c) => c.query(score(ids.directorA, "3.1.A", "2"))));
    const state = await asOwner(p, async (c) => ({
      site: (await c.query("select director_submitted_by from public.program_review_sites where id = $1", [site10])).rows[0],
      review: (await c.query("select status::text as s from public.program_reviews where id = app.site_program_review($1)", [site10])).rows[0],
      logged: (await c.query("select count(*)::int as n from public.audit_events where action = 'self_scores.submitted' and entity_id = $1", [site10])).rows[0].n,
    }));
    expect(state.site.director_submitted_by).toBe(ids.directorA);
    expect(state.review.s).toBe("evidence_submitted");
    expect(state.logged).toBe(1);
    await expectDenied(withRole(p, claims(ids.reviewer1), (c) => c.query("select app.reopen_director_scores($1, 'late evidence', null)", [site10])));
    await asAdmin((c) => c.query("select app.reopen_director_scores($1, 'late evidence', current_date + 7)", [site10]));
    await withRole(p, claims(ids.directorA), async (c) => {
      const r = await c.query(score(ids.directorA, "3.1.A", "2"));
      expect(r.rowCount).toBe(1);
    });
  });

  it("scores are read by staff in scope and leadership, by the Director, never by a teacher or another LEA", async () => {
    const count = (sub: string) => withRole(p, claims(sub), async (c) => (await c.query("select id from public.current_scores")).rowCount);
    expect(await count(ids.directorA)).toBeGreaterThan(0);
    expect(await count(ids.staffA)).toBeGreaterThan(0);
    expect(await count(ids.reviewer1)).toBeGreaterThan(0);
    expect(await count(ids.clusterAdmin)).toBeGreaterThan(0);
    expect(await count(ids.leadership)).toBeGreaterThan(0);
    expect(await count(ids.teacherUserA1)).toBe(0);
    expect(await count(ids.reviewer2)).toBe(0);
    expect(await count(ids.directorB)).toBe(0);
  });
});

describe("Form 14-1 and credential results", () => {
  let formId = "";
  it("district roles draft, only the Director submits, and a submitted form is frozen", async () => {
    await asUser(p, claims(ids.teacherUserA1), async (c) => {
      formId = (await c.query("insert into public.form_141 (lea_id, school_year_id, declared_program_id, completed_by) values ($1, $2, $3, $4) returning id", [ids.leaA, yearId, dp10, ids.teacherUserA1])).rows[0].id;
      await c.query("insert into public.form_141_items (form_id, qpi_code, score, corrective_action, updated_by) values ($1, '1.1.A', '2', null, $2)", [formId, ids.teacherUserA1]);
      await expect(c.query("select app.submit_form_141($1)", [formId])).rejects.toThrow();
    });
    await expectDenied(withRole(p, claims(ids.teacherUserA2), (c) => c.query("insert into public.form_141_items (form_id, qpi_code, score, updated_by) values ($1, '1.1.B', '1', $2)", [formId, ids.teacherUserA2])));
    const otherLea = await withRole(p, claims(ids.directorB), async (c) => (await c.query("select id from public.form_141")).rowCount);
    expect(otherLea).toBe(0);
    await asUser(p, claims(ids.directorA), async (c) => {
      await c.query("insert into public.form_141_items (form_id, qpi_code, score, corrective_action, updated_by) values ($1, '1.1.B', '1', 'affiliate with the CTSO', $2)", [formId, ids.directorA]);
      await c.query("select app.submit_form_141($1)", [formId]);
      await expectDenied(c.query("insert into public.form_141_items (form_id, qpi_code, score, updated_by) values ($1, '1.1.C', '2', $2)", [formId, ids.directorA]));
      const updated = await c.query("update public.form_141 set comments = 'late' where id = $1", [formId]);
      expect(updated.rowCount).toBe(0);
    });
    const reviewer = await withRole(p, claims(ids.reviewer1), async (c) => (await c.query("select status from public.form_141")).rows);
    expect(reviewer).toEqual([{ status: "submitted" }]);
    await expectDenied(withRole(p, claims(ids.directorA), (c) => c.query("select app.reopen_form_141($1, 'fix')", [formId])));
  });

  it("credential counts are entered by the LEA, read by leadership as counts, never by a teacher of another program", async () => {
    await expectDenied(withRole(p, claims(ids.teacherUserA1), (c) => c.query("insert into public.credential_results (lea_id, school_year_id, declared_program_id, credential_name, test_takers, passers) values ($1, $2, $3, 'Fabricated Credential', 10, 9)", [ids.leaA, yearId, dp10])));
    await withRole(p, claims(ids.directorA), async (c) => {
      await fails(c, "insert into public.credential_results (lea_id, school_year_id, declared_program_id, credential_name, test_takers, passers) values ($1, $2, $3, 'Fabricated Credential', 5, 9)", [ids.leaA, yearId, dp10], /check constraint/);
      await c.query("insert into public.credential_results (lea_id, school_year_id, declared_program_id, credential_name, test_takers, passers) values ($1, $2, $3, 'Fabricated Credential', 10, 9)", [ids.leaA, yearId, dp10]);
      expect((await c.query("select id from public.credential_results")).rowCount).toBe(1);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.leadership, role: "authenticated", aal: "aal2" })]);
      expect((await c.query("select test_takers from public.credential_results")).rowCount).toBe(1);
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: ids.teacherUserA2, role: "authenticated", aal: "aal2" })]);
      expect((await c.query("select test_takers from public.credential_results")).rowCount).toBe(0);
    });
  });
});
