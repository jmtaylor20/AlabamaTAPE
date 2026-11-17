import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, expectDenied, pool, withRole } from "./harness";
import { instrumentSql } from "../../scripts/db/seed-instrument.mjs";

/**
 * Phase 2 tests: the instrument seeds and locks, declarations respect the
 * one-time window and record revisions, the random draw is reproducible,
 * the embargo hides selections, reviewers, and dates from district roles
 * until release, release is logged, and a Reviewer cannot read a review
 * they are not assigned to.
 */

let p: pg.Pool;
const ids = {
  leaA: "aaaaaaaa-0000-4000-8000-00000000000a",
  leaB: "bbbbbbbb-0000-4000-8000-00000000000b",
  schoolA: "aaaaaaaa-0000-4000-8000-00000000001a",
  schoolA2: "aaaaaaaa-0000-4000-8000-00000000004a",
  schoolB: "bbbbbbbb-0000-4000-8000-00000000001b",
  teacherA1: "aaaaaaaa-0000-4000-8000-00000000002a",
  teacherA2: "aaaaaaaa-0000-4000-8000-00000000003a",
  admin: "10000000-0000-4000-8000-000000000001",
  directorA: "10000000-0000-4000-8000-00000000000a",
  directorB: "10000000-0000-4000-8000-00000000000b",
  teacherUserA1: "10000000-0000-4000-8000-00000000002a",
  reviewer1: "10000000-0000-4000-8000-000000000002",
  reviewer2: "10000000-0000-4000-8000-000000000004",
  clusterAdmin: "10000000-0000-4000-8000-000000000005",
  leadership: "10000000-0000-4000-8000-000000000003",
};
let yearId = "";
let cycleId = "";
let reviewA = "";
let reviewB = "";

async function signUp(c: pg.PoolClient, id: string, email: string) {
  await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    yearId = (await c.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true) returning id")).rows[0].id;
    await c.query(`
      insert into public.clusters (code, name) values ('01', 'Agriculture'), ('02', 'Construction');
      insert into public.program_catalog (code, name, cluster_code, is_coop) values ('10', 'General Agriculture', '01', false), ('11', 'Welding', '02', false), ('12', 'Animal Science', '01', false), ('13', 'Plant Science', '01', false), ('14', 'Cooperative Education', '02', true);
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '901', 'Riverbend County'), ('${ids.leaB}', '902', 'Pine Ridge City');
      insert into public.schools (id, lea_id, school_code, name) values ('${ids.schoolA}', '${ids.leaA}', '0010', 'Riverbend High School'), ('${ids.schoolA2}', '${ids.leaA}', '6000', 'Riverbend CTC'), ('${ids.schoolB}', '${ids.leaB}', '0010', 'Pine Ridge High School');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'riverbend.example.edu'), ('${ids.leaB}', 'pineridge.example.edu'), (null, 'state.example.gov');
      insert into public.teachers (id, lea_id, display_name, email) values ('${ids.teacherA1}', '${ids.leaA}', 'Avery Abernathy', 'avery.abernathy@riverbend.example.edu'), ('${ids.teacherA2}', '${ids.leaA}', 'Jordan Blackwood', 'jordan.blackwood@riverbend.example.edu');
      insert into public.holidays (holiday_on, name, scope) values ('2027-01-18', 'Martin Luther King Jr. Day', 'federal'), ('2026-11-13', 'Test holiday on a Friday', 'state');
      insert into public.invitations (email, role, lea_id, cluster_code, teacher_id) values
        ('admin@state.example.gov', 'state_admin', null, null, null),
        ('reviewer1@state.example.gov', 'reviewer', null, null, null),
        ('reviewer2@state.example.gov', 'reviewer', null, null, null),
        ('cluster@state.example.gov', 'cluster_admin', null, '01', null),
        ('leader@state.example.gov', 'leadership', null, null, null),
        ('director@riverbend.example.edu', 'cte_director', '${ids.leaA}', null, null),
        ('avery.abernathy@riverbend.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA1}'),
        ('director@pineridge.example.edu', 'cte_director', '${ids.leaB}', null, null);
    `);
    await signUp(c, ids.admin, "admin@state.example.gov");
    await signUp(c, ids.reviewer1, "reviewer1@state.example.gov");
    await signUp(c, ids.reviewer2, "reviewer2@state.example.gov");
    await signUp(c, ids.clusterAdmin, "cluster@state.example.gov");
    await signUp(c, ids.leadership, "leader@state.example.gov");
    await signUp(c, ids.directorA, "director@riverbend.example.edu");
    await signUp(c, ids.teacherUserA1, "avery.abernathy@riverbend.example.edu");
    await signUp(c, ids.directorB, "director@pineridge.example.edu");
    await c.query(instrumentSql());
    cycleId = (await c.query("insert into public.review_cycles (school_year_id, name, settings) values ($1, '2026-2027 TAPE', '{\"january_evidence_due\": \"2027-01-04\"}') returning id", [yearId])).rows[0].id;
    // LEA A declares five programs; one is vacant, one is taught at another LEA's center.
    await c.query(`
      insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type) values
        ('${ids.leaA}', '${yearId}', '${ids.schoolA}', '10', 'LOCAL'), ('${ids.leaA}', '${yearId}', '${ids.schoolA}', '11', 'LOCAL'), ('${ids.leaA}', '${yearId}', '${ids.schoolA2}', '12', 'LOCAL'), ('${ids.leaA}', '${yearId}', '${ids.schoolA2}', '13', 'LOCAL');
      insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type, vacant) values ('${ids.leaA}', '${yearId}', '${ids.schoolA}', '14', 'LOCAL', true);
      insert into public.declared_programs (lea_id, school_year_id, home_school_id, location_lea_id, location_school_id, program_code, delivery_type) values ('${ids.leaA}', '${yearId}', '${ids.schoolA2}', '${ids.leaB}', '${ids.schoolB}', '10', 'LOCAL');
      insert into public.declared_program_teachers (declared_program_id, teacher_id) select id, '${ids.teacherA1}' from public.declared_programs where lea_id = '${ids.leaA}' and program_code = '10' and home_school_id = '${ids.schoolA}';
      insert into public.declared_program_teachers (declared_program_id, teacher_id) select id, '${ids.teacherA2}' from public.declared_programs where lea_id = '${ids.leaA}' and program_code = '11';
      insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code, delivery_type) values ('${ids.leaB}', '${yearId}', '${ids.schoolB}', '11', 'LOCAL'), ('${ids.leaB}', '${yearId}', '${ids.schoolB}', '12', 'LOCAL');
    `);
    reviewA = (await c.query("insert into public.lea_reviews (cycle_id, lea_id, review_month, review_year) values ($1, $2, 1, 2027) returning id", [cycleId, ids.leaA])).rows[0].id;
    reviewB = (await c.query("insert into public.lea_reviews (cycle_id, lea_id, review_month, review_year) values ($1, $2, 12, 2026) returning id", [cycleId, ids.leaB])).rows[0].id;
  });
});

afterAll(async () => {
  await asOwner(p, (c) =>
    c.query(`truncate public.audit_events, public.scope_changes, public.review_assignments, public.program_review_site_teachers, public.program_review_sites, public.program_reviews, public.selections, public.selection_draws,
      public.milestones, public.lea_reviews, public.declaration_revisions, public.declaration_windows, public.declared_program_teachers, public.declared_programs, public.declaration_imports, public.compliance_list, public.review_cycles, public.lea_contacts,
      public.checklist_items, public.scoring_rules, public.epic_descriptors, public.qpi_subitems, public.qpis, public.instrument_sections, public.instrument_versions,
      public.staff_pairings, public.invitations, public.teacher_years, public.teachers, public.role_grants, public.profiles, public.holidays, public.approved_domains, public.schools, public.leas, public.program_catalog, public.clusters, public.school_years, auth.users restart identity cascade`),
  );
  await p.end();
});

describe("instrument", () => {
  it("seeds the 2026-2027 tool as a published version with 24 QPIs and the ASE and dual-enrollment flags", async () => {
    const seen = await withRole(p, { sub: ids.directorA }, async (c) => ({
      versions: (await c.query("select status from public.instrument_versions")).rows.map((r) => r.status),
      qpis: (await c.query("select count(*)::int as n from public.qpis")).rows[0].n,
      ase: (await c.query("select code from public.qpis where satisfied_by_ase order by code")).rows.map((r) => r.code),
      dual3: (await c.query("select code from public.qpis where dual_scenario3_included order by code")).rows.map((r) => r.code),
      coop: (await c.query("select code from public.qpis where applies_to = 'coop_only'")).rows.map((r) => r.code),
      subitems: (await c.query("select count(*)::int as n from public.qpi_subitems s join public.qpis q on q.id = s.qpi_id where q.code = '2.1.G'")).rows[0].n,
      rule: (await c.query("select operator, threshold, epic_threshold from public.scoring_rules where rule_key = 'credential_pass_rate'")).rows[0],
    }));
    expect(seen.versions).toEqual(["published"]);
    expect(seen.qpis).toBe(24);
    expect(seen.ase).toEqual(["3.1.A", "3.1.B", "3.1.C", "3.1.D", "3.1.E", "4.1.A", "5.1.A", "5.1.B"]);
    expect(seen.dual3).toEqual(["1.1.A", "1.1.B", "1.1.C", "1.1.D", "1.1.E", "1.1.F", "2.1.F", "2.1.G", "3.1.C", "3.1.D"]);
    expect(seen.coop).toEqual(["5.2.A"]);
    expect(seen.subitems).toBe(11);
    expect(seen.rule).toEqual({ operator: ">=", threshold: "88", epic_threshold: "95" });
  });

  it("refuses edits to a published version, even by the State Admin", async () => {
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("update public.qpis set title = 'changed' where code = '2.1.H'")));
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("update public.scoring_rules set threshold = 50 where rule_key = 'credential_pass_rate'")));
  });
});

describe("milestones", () => {
  it("computes the January rule: release two months ahead, moved off a Friday holiday, and the state-set evidence date", async () => {
    const rows = await withRole(p, { sub: ids.admin }, async (c) => (await c.query("select kind, computed_on::text as d from public.milestones where lea_review_id = $1 order by kind", [reviewA])).rows);
    const by = Object.fromEntries(rows.map((r) => [r.kind, r.d]));
    expect(by.notification).toBe("2026-11-06"); // 13 Nov 2026 is a holiday in this test, so the prior Friday
    expect(by.evidence_due).toBe("2027-01-04");
    expect(by.check_in).toBe("2026-11-20");
  });

  it("moves a weekend 13th to the prior Friday and uses the 1st for other months", async () => {
    const rows = await withRole(p, { sub: ids.admin }, async (c) => (await c.query("select kind, computed_on::text as d from public.milestones where lea_review_id = $1", [reviewB])).rows);
    const by = Object.fromEntries(rows.map((r) => [r.kind, r.d]));
    expect(by.notification).toBe("2026-11-06"); // 13 Nov 2026 is the test holiday; the rule lands on the prior Friday
    expect(by.evidence_due).toBe("2026-12-01");
    expect(by.check_in).toBe("2026-10-20");
    const sat = await withRole(p, { sub: ids.admin }, async (c) => (await c.query("select app.notification_date(4, 2027)::text as d")).rows[0].d);
    expect(sat).toBe("2027-03-12"); // 13 Mar 2027 is a Saturday
  });

  it("derives the ten-day close and PIP clock from the visit end", async () => {
    await asOwner(p, (c) => c.query("update public.lea_reviews set visit_start = '2027-01-25', visit_end = '2027-01-26' where id = $1", [reviewA]));
    const rows = await withRole(p, { sub: ids.admin }, async (c) => (await c.query("select kind, computed_on::text as d from public.milestones where lea_review_id = $1", [reviewA])).rows);
    const by = Object.fromEntries(rows.map((r) => [r.kind, r.d]));
    expect(by.ten_day_close).toBe("2027-02-05");
    expect(by.pip_start).toBe("2027-02-06");
    expect(by.pip_due).toBe("2028-02-06");
  });
});

describe("declarations and the review window", () => {
  it("a Director cannot change declarations while no window is open", async () => {
    const updated = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("update public.declared_programs set ase_accredited = true where lea_id = $1 and program_code = '11'", [ids.leaA])).rowCount);
    expect(updated).toBe(0);
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '13')", [ids.leaA, yearId, ids.schoolA])));
  });

  it("inside an open window a Director can edit, every change is recorded, and confirming closes it", async () => {
    await asOwner(p, (c) => c.query("insert into public.declaration_windows (lea_id, school_year_id, closes_at, opened_by) values ($1, $2, now() + interval '7 days', $3)", [ids.leaA, yearId, ids.admin]));
    const result = await withRole(p, { sub: ids.directorA }, async (c) => {
      const updated = (await c.query("update public.declared_programs set ase_accredited = true where lea_id = $1 and program_code = '11'", [ids.leaA])).rowCount;
      const revs = (await c.query("select action, before ->> 'ase_accredited' as b, after ->> 'ase_accredited' as a, actor_id, window_id is not null as in_window from public.declaration_revisions where lea_id = $1 and action = 'declared_programs.update'", [ids.leaA])).rows;
      const other = (await c.query("update public.declared_programs set ase_accredited = true where lea_id = $1", [ids.leaB])).rowCount;
      return { updated, revs, other };
    });
    expect(result.updated).toBe(1);
    expect(result.revs).toEqual([{ action: "declared_programs.update", b: "false", a: "true", actor_id: ids.directorA, in_window: true }]);
    expect(result.other).toBe(0);
    const confirmed = await withRole(p, { sub: ids.directorA }, async (c) => {
      await c.query("update public.declaration_windows set confirmed_at = now(), confirmed_by = $1 where lea_id = $2", [ids.directorA, ids.leaA]);
      return (await c.query("update public.declared_programs set ase_accredited = false where lea_id = $1 and program_code = '11'", [ids.leaA])).rowCount;
    });
    expect(confirmed).toBe(0);
  });

  it("a Teacher sees only declared programs they teach", async () => {
    const codes = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => (await c.query("select program_code from public.declared_programs order by 1")).rows.map((r) => r.program_code));
    expect(codes).toEqual(["10"]);
  });
});

describe("selection", () => {
  it("counts only eligible programs toward the target and excludes vacant and other-LEA programs", async () => {
    const target = await withRole(p, { sub: ids.admin }, async (c) => (await c.query("select app.selection_target($1) as t", [reviewA])).rows[0].t);
    // Four eligible programs at 25 percent, rounded up, gives one.
    expect(target).toBe(1);
  });

  it("a Reviewer can nominate an eligible program and cannot nominate an ineligible one", async () => {
    const nominated = await withRole(p, { sub: ids.reviewer1 }, async (c) =>
      (await c.query("insert into public.selections (lea_review_id, declared_program_id, method, nominated_by) select $1, id, 'nominated', $2 from public.declared_programs where lea_id = $3 and program_code = '11' returning id", [reviewA, ids.reviewer1, ids.leaA])).rowCount,
    );
    expect(nominated).toBe(1);
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) =>
      c.query("insert into public.selections (lea_review_id, declared_program_id, method, nominated_by) select $1, id, 'nominated', $2 from public.declared_programs where lea_id = $3 and program_code = '14'", [reviewA, ids.reviewer1, ids.leaA]),
    ));
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) =>
      c.query("insert into public.selections (lea_review_id, declared_program_id, method, nominated_by) select $1, id, 'nominated', $2 from public.declared_programs where lea_id = $3 and program_code = '12'", [reviewA, ids.directorA, ids.leaA]),
    ));
  });

  it("the random draw is reproducible from its seed and only the State Admin can run it", async () => {
    // Persist one nomination (the previous test's insert was rolled back) and set the target to three.
    await asOwner(p, async (c) => {
      await c.query("insert into public.selections (lea_review_id, declared_program_id, method, nominated_by) select $1, id, 'nominated', $2 from public.declared_programs where lea_id = $3 and program_code = '11' on conflict do nothing", [reviewA, ids.reviewer1, ids.leaA]);
      await c.query("update public.lea_reviews set target_override = 3, target_override_reason = 'test' where id = $1", [reviewA]);
    });
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query("select app.run_selection_draw($1, 'seed-1')", [reviewA])));
    const first = await withRole(p, { sub: ids.admin }, async (c) => {
      const draw = (await c.query("select app.run_selection_draw($1, 'seed-1') as id", [reviewA])).rows[0].id;
      return (await c.query("select result -> 'drawn' as drawn, target_count, jsonb_array_length(excluded) as excluded from public.selection_draws where id = $1", [draw])).rows[0];
    });
    const second = await withRole(p, { sub: ids.admin }, async (c) => {
      const draw = (await c.query("select app.run_selection_draw($1, 'seed-1') as id", [reviewA])).rows[0].id;
      return (await c.query("select result -> 'drawn' as drawn from public.selection_draws where id = $1", [draw])).rows[0];
    });
    const third = await withRole(p, { sub: ids.admin }, async (c) => {
      const draw = (await c.query("select app.run_selection_draw($1, 'seed-2') as id", [reviewA])).rows[0].id;
      return (await c.query("select result -> 'drawn' as drawn, seed from public.selection_draws where id = $1", [draw])).rows[0];
    });
    expect(first.target_count).toBe(3);
    expect(first.drawn).toHaveLength(2);
    expect(first.excluded).toBe(2);
    expect(second.drawn).toEqual(first.drawn);
    // With a pool this small two seeds can land on the same programs, so check the seed is recorded rather than that the results differ.
    expect(third.seed).toBe("seed-2");
    expect(third.drawn).toHaveLength(2);
  });
});

describe("embargo and release", () => {
  beforeAll(async () => {
    // Run the draw as the admin so it persists, then assign a reviewer.
    const client = await p.connect();
    try {
      await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: ids.admin, role: "authenticated", aal: "aal2" })]);
      await client.query("select app.run_selection_draw($1, 'final')", [reviewA]);
      await client.query("select app.materialize_program_reviews($1)", [reviewA]);
      await client.query("insert into public.review_assignments (program_review_id, user_id, email, assignment_role, assigned_by) select id, $1, 'reviewer1@state.example.gov', 'lead_reviewer', $2 from public.program_reviews where lea_review_id = $3", [ids.reviewer1, ids.admin, reviewA]);
      await client.query("select set_config('request.jwt.claims', '', false)");
    } finally {
      client.release();
    }
  });

  it("before release, district roles see no review, selections, assignments, sites, or milestones", async () => {
    const seen = await withRole(p, { sub: ids.directorA }, async (c) => ({
      reviews: (await c.query("select id from public.lea_reviews")).rowCount,
      selections: (await c.query("select id from public.selections")).rowCount,
      programReviews: (await c.query("select id from public.program_reviews")).rowCount,
      assignments: (await c.query("select id from public.review_assignments")).rowCount,
      sites: (await c.query("select id from public.program_review_sites")).rowCount,
      milestones: (await c.query("select id from public.milestones")).rowCount,
      draws: (await c.query("select id from public.selection_draws")).rowCount,
      changeLog: (await c.query("select id from public.change_log where entity_type in ('selections', 'program_reviews', 'review_assignments')")).rowCount,
      summary: (await c.query("select review_month, released, status, notification_on::text as n from app.my_lea_review_summary()")).rows,
    }));
    expect(seen).toMatchObject({ reviews: 0, selections: 0, programReviews: 0, assignments: 0, sites: 0, milestones: 0, draws: 0, changeLog: 0 });
    expect(seen.summary).toEqual([{ review_month: 1, released: false, status: "listed", n: "2026-11-06" }]);
    const teacher = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => (await c.query("select id from public.program_reviews")).rowCount);
    expect(teacher).toBe(0);
  });

  it("a Reviewer reads only the program reviews they are assigned to", async () => {
    const assigned = await withRole(p, { sub: ids.reviewer1 }, async (c) => (await c.query("select id from public.program_reviews")).rowCount);
    const unassigned = await withRole(p, { sub: ids.reviewer2 }, async (c) => ({
      reviews: (await c.query("select id from public.program_reviews")).rowCount,
      sites: (await c.query("select id from public.program_review_sites")).rowCount,
      assignments: (await c.query("select id from public.review_assignments")).rowCount,
    }));
    expect(assigned).toBeGreaterThan(0);
    expect(unassigned).toEqual({ reviews: 0, sites: 0, assignments: 0 });
  });

  it("a Cluster Administrator reads program reviews in their cluster only", async () => {
    const codes = await withRole(p, { sub: ids.clusterAdmin }, async (c) => (await c.query("select program_code from public.program_reviews order by 1")).rows.map((r) => r.program_code));
    for (const code of codes) expect(["10", "12", "13"]).toContain(code);
  });

  it("only the State Admin can release, release is logged, and afterward the district sees its review", async () => {
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query("select app.release_notification($1)", [reviewA])));
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("select app.release_notification($1)", [reviewA])));
    const client = await p.connect();
    try {
      await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: ids.admin, role: "authenticated", aal: "aal2" })]);
      await client.query("select app.release_notification($1)", [reviewA]);
      await client.query("select set_config('request.jwt.claims', '', false)");
    } finally {
      client.release();
    }
    const logged = await asOwner(p, async (c) => (await c.query("select actor_id, lea_id from public.audit_events where action = 'lea_review.released' and entity_id = $1", [reviewA])).rows);
    expect(logged).toEqual([{ actor_id: ids.admin, lea_id: ids.leaA }]);
    const seen = await withRole(p, { sub: ids.directorA }, async (c) => ({
      reviews: (await c.query("select status::text as s, visit_start::text as v from public.lea_reviews")).rows,
      programReviews: (await c.query("select id from public.program_reviews")).rowCount,
      assignments: (await c.query("select email from public.review_assignments")).rows.map((r) => r.email),
      milestones: (await c.query("select id from public.milestones")).rowCount,
      otherLea: (await c.query("select id from public.lea_reviews where lea_id = $1", [ids.leaB])).rowCount,
    }));
    expect(seen.reviews).toEqual([{ s: "released", v: "2027-01-25" }]);
    expect(seen.programReviews).toBeGreaterThan(0);
    expect(seen.assignments).toContain("reviewer1@state.example.gov");
    expect(seen.milestones).toBe(8);
    expect(seen.otherLea).toBe(0);
  });

  it("a release cannot be undone and selections lock after release", async () => {
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("update public.lea_reviews set released_at = null where id = $1", [reviewA])));
    await expect(withRole(p, { sub: ids.admin }, (c) => c.query("select app.run_selection_draw($1, 'late')", [reviewA]))).rejects.toMatchObject({ code: "42501" });
  });
});

describe("import jobs", () => {
  it("only the State Admin can see or create import previews", async () => {
    await withRole(p, { sub: ids.admin }, async (c) => {
      const r = await c.query("insert into public.import_jobs (kind, file_name, plan, created_by) values ('declarations', 'fabricated.xlsx', '{}'::jsonb, $1) returning id", [ids.admin]);
      expect(r.rowCount).toBe(1);
    });
    await withRole(p, { sub: ids.directorA }, async (c) => {
      const r = await c.query("select id from public.import_jobs");
      expect(r.rowCount).toBe(0);
      await expectDenied(c.query("insert into public.import_jobs (kind, file_name, plan) values ('declarations', 'x.xlsx', '{}'::jsonb)"));
    });
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      const r = await c.query("select id from public.import_jobs");
      expect(r.rowCount).toBe(0);
    });
  });
});
