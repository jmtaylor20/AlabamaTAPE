import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, asUser, denied, expectDenied, fails, pool, withRole } from "./harness";
import { instrumentSql } from "../../scripts/db/seed-instrument.mjs";

/**
 * Phase 5 tests: a PIP is created from the open findings of a finalized review
 * with the clock starting the day after the ten-day close; goals and monthly
 * progress belong to the assigned reviewer; the Director and the program's
 * teacher add notes; leadership sees status only; escalations at months 6, 9,
 * and 11 are recorded once each while goals stay open; the State Admin closes.
 */

let p: pg.Pool;
const ids = {
  leaA: "eeeeeeee-0000-4000-8000-00000000000a",
  schoolA: "eeeeeeee-0000-4000-8000-00000000001a",
  teacherA1: "eeeeeeee-0000-4000-8000-00000000002a",
  teacherA2: "eeeeeeee-0000-4000-8000-00000000003a",
  admin: "50000000-0000-4000-8000-000000000001",
  reviewer1: "50000000-0000-4000-8000-000000000002",
  reviewer2: "50000000-0000-4000-8000-000000000004",
  clusterAdmin: "50000000-0000-4000-8000-000000000005",
  leadership: "50000000-0000-4000-8000-000000000003",
  directorA: "50000000-0000-4000-8000-00000000000a",
  teacherUserA1: "50000000-0000-4000-8000-00000000002a",
  teacherUserA2: "50000000-0000-4000-8000-00000000003a",
};
let yearId = "";
let reviewA = "";
let pr10 = "";
let site10 = "";
let pipId = "";
const now = () => Math.floor(Date.now() / 1000);
const fresh = (sub: string) => ({ sub, amr: [{ method: "totp", timestamp: now() - 60 }] });

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    yearId = (await c.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true) returning id")).rows[0].id;
    await c.query(`
      insert into public.clusters (code, name) values ('01', 'Agriculture');
      insert into public.program_catalog (code, name, cluster_code, is_coop) values ('10', 'General Agriculture', '01', false), ('11', 'Animal Science', '01', false);
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '906', 'Willow Creek County');
      insert into public.schools (id, lea_id, school_code, name) values ('${ids.schoolA}', '${ids.leaA}', '0040', 'Willow Creek High School');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'willowcreek.example.edu'), (null, 'state.example.gov');
      insert into public.teachers (id, lea_id, display_name, email) values ('${ids.teacherA1}', '${ids.leaA}', 'Hollis Fenwick', 'hollis.fenwick@willowcreek.example.edu'), ('${ids.teacherA2}', '${ids.leaA}', 'Marlo Standish', 'marlo.standish@willowcreek.example.edu');
      insert into public.invitations (email, role, lea_id, cluster_code, teacher_id) values
        ('admin@state.example.gov', 'state_admin', null, null, null), ('reviewer1@state.example.gov', 'reviewer', null, null, null), ('reviewer2@state.example.gov', 'reviewer', null, null, null),
        ('cluster@state.example.gov', 'cluster_admin', null, '01', null), ('leader@state.example.gov', 'leadership', null, null, null), ('director@willowcreek.example.edu', 'cte_director', '${ids.leaA}', null, null),
        ('hollis.fenwick@willowcreek.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA1}'), ('marlo.standish@willowcreek.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA2}');
    `);
    for (const [id, email] of [[ids.admin, "admin@state.example.gov"], [ids.reviewer1, "reviewer1@state.example.gov"], [ids.reviewer2, "reviewer2@state.example.gov"], [ids.clusterAdmin, "cluster@state.example.gov"], [ids.leadership, "leader@state.example.gov"], [ids.directorA, "director@willowcreek.example.edu"], [ids.teacherUserA1, "hollis.fenwick@willowcreek.example.edu"], [ids.teacherUserA2, "marlo.standish@willowcreek.example.edu"]])
      await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await c.query(instrumentSql());
    const cycleId = (await c.query("insert into public.review_cycles (school_year_id, name) values ($1, '2026-2027 TAPE') returning id", [yearId])).rows[0].id;
    const dp10 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '10') returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    const dp11 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '11') returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    await c.query("insert into public.declared_program_teachers (declared_program_id, teacher_id) values ($1, $2), ($3, $4)", [dp10, ids.teacherA1, dp11, ids.teacherA2]);
    reviewA = (await c.query("insert into public.lea_reviews (cycle_id, lea_id, review_month, review_year, visit_start, visit_end) values ($1, $2, 10, 2026, '2026-10-06', '2026-10-07') returning id", [cycleId, ids.leaA])).rows[0].id;
    await c.query("insert into public.selections (lea_review_id, declared_program_id, method) values ($1, $2, 'manual')", [reviewA, dp10]);
  });
  await asUser(p, { sub: ids.admin }, async (c) => {
    await c.query("select app.materialize_program_reviews($1)", [reviewA]);
    await c.query("insert into public.review_assignments (program_review_id, user_id, email, assignment_role, assigned_by) select id, $1, 'reviewer1@state.example.gov', 'lead_reviewer', $2 from public.program_reviews where lea_review_id = $3", [ids.reviewer1, ids.admin, reviewA]);
    await c.query("insert into public.review_assignments (program_review_id, user_id, email, assignment_role, assigned_by) select id, $1, 'cluster@state.example.gov', 'cluster_admin', $2 from public.program_reviews where lea_review_id = $3", [ids.clusterAdmin, ids.admin, reviewA]);
    await c.query("select app.release_notification($1)", [reviewA]);
    site10 = (await c.query("select app.site_for_declared_program($1) as id", [await dp10Id(c)])).rows[0].id;
    pr10 = (await c.query("select app.site_program_review($1) as id", [site10])).rows[0].id;
  });
  // Score everything, with two Level 1s, record the meeting, and finalize.
  await asUser(p, { sub: ids.reviewer1 }, async (c) => {
    const codes = (await c.query("select code from app.applicable_qpi_codes($1) code", [site10])).rows.map((r) => r.code as string);
    for (const code of codes) await c.query("insert into public.score_entries (site_id, qpi_code, scorer_role, value, comment, author_id) values ($1, $2, 'reviewer', $3, $4, $5)", [site10, code, ["1.1.C", "3.1.C"].includes(code) ? "1" : "2", code === "1.1.C" ? "Only two meetings documented." : code === "3.1.C" ? "Advisory roster has three members." : null, ids.reviewer1]);
    await c.query("insert into public.consistency_meetings (lea_review_id, held_on, attendees, recorded_by) values ($1, '2026-10-09', 'Reviewer 1, Cluster Admin', $2)", [reviewA, ids.reviewer1]);
  });
  await asUser(p, fresh(ids.reviewer1), (c) => c.query("select app.finalize_program_review($1)", [pr10]));
});

function dp10Id(c: pg.PoolClient) {
  return c.query("select id from public.declared_programs where program_code = '10' and lea_id = $1", [ids.leaA]).then((r) => r.rows[0].id as string);
}

afterAll(async () => {
  await asOwner(p, (c) =>
    c.query(`truncate public.audit_events, public.pip_escalations, public.pip_notes, public.pip_progress, public.pip_goals, public.pips, public.finalizations, public.findings, public.consistency_meetings, public.desk_audits, public.onsite_checks, public.audit_samples, public.section_comments, public.epic_scores,
      public.score_entries, public.credential_results, public.form_141_items, public.form_141, public.evidence_access, public.evidence_qpi_links, public.evidence_files,
      public.scope_changes, public.review_assignments, public.program_review_site_teachers, public.program_review_sites, public.program_reviews, public.selections, public.selection_draws,
      public.milestones, public.lea_reviews, public.declaration_revisions, public.declaration_windows, public.declared_program_teachers, public.declared_programs, public.declaration_imports, public.compliance_list, public.review_cycles, public.lea_contacts,
      public.checklist_items, public.scoring_rules, public.epic_descriptors, public.qpi_subitems, public.qpis, public.instrument_sections, public.instrument_versions,
      public.staff_pairings, public.invitations, public.teacher_years, public.teachers, public.role_grants, public.profiles, public.holidays, public.approved_domains, public.schools, public.leas, public.program_catalog, public.clusters, public.school_years, auth.users restart identity cascade`),
  );
  await p.end();
});

describe("creating a PIP", () => {
  it("only an assigned reviewer or the State Admin creates it, from the open findings, with the clock set from the ten-day close", async () => {
    await expectDenied(withRole(p, { sub: ids.reviewer2 }, (c) => c.query("select app.create_pip($1)", [pr10])));
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("select app.create_pip($1)", [pr10])));
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      await fails(c, "select app.conclude_program_review($1)", [pr10], /create the PIP/);
    });
    pipId = await asUser(p, { sub: ids.reviewer1 }, async (c) => (await c.query("select app.create_pip($1) as id", [pr10])).rows[0].id);
    const pip = await asOwner(p, async (c) => ({
      row: (await c.query("select status, ten_day_close::text as c, starts_on::text as s, due_on::text as d from public.pips where id = $1", [pipId])).rows[0],
      goals: (await c.query("select qpi_code, finding_id is not null as linked, status from public.pip_goals where pip_id = $1 order by sort", [pipId])).rows,
    }));
    expect(pip.row).toEqual({ status: "open", c: "2026-10-17", s: "2026-10-18", d: "2027-10-18" });
    expect(pip.goals).toEqual([{ qpi_code: "1.1.C", linked: true, status: null }, { qpi_code: "3.1.C", linked: true, status: null }]);
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      await fails(c, "select app.create_pip($1)", [pr10], /already has a PIP/);
      await c.query("select app.conclude_program_review($1)", [pr10]);
      expect((await c.query("select status::text as s from public.program_reviews where id = $1", [pr10])).rows[0].s).toBe("concluded");
      expect((await c.query("select status::text as s from public.lea_reviews where id = $1", [reviewA])).rows[0].s).toBe("concluded");
    });
  });

  it("the reviewer writes goals and monthly progress; district roles add notes; leadership sees status only", async () => {
    await withRole(p, { sub: ids.directorA }, async (c) => {
      expect((await c.query("update public.pip_goals set action_steps = 'x' where pip_id = $1", [pipId])).rowCount).toBe(0);
      await denied(c, "insert into public.pip_progress (pip_id, month, body, entered_by) values ($1, 1, 'x', $2)", [pipId, ids.directorA]);
      await denied(c, "insert into public.pip_notes (pip_id, author_role, body, author_id) values ($1, 'reviewer', 'x', $2)", [pipId, ids.directorA]);
      const r = await c.query("insert into public.pip_notes (pip_id, author_role, body, author_id) values ($1, 'director', 'Advisory recruiting two members from the co-op.', $2)", [pipId, ids.directorA]);
      expect(r.rowCount).toBe(1);
    });
    await asUser(p, { sub: ids.reviewer1 }, async (c) => {
      await c.query("update public.pip_goals set action_steps = 'Schedule and document four CTSO meetings; upload minutes.', updated_at = now() where pip_id = $1 and qpi_code = '1.1.C'", [pipId]);
      await c.query("insert into public.pip_progress (pip_id, month, body, progress_lacking, entered_by) values ($1, 1, 'Two meetings held in October; minutes uploaded.', false, $2)", [pipId, ids.reviewer1]);
    });
    await withRole(p, { sub: ids.teacherUserA1 }, async (c) => {
      expect((await c.query("select action_steps from public.pip_goals where pip_id = $1 and qpi_code = '1.1.C'", [pipId])).rows[0].action_steps).toMatch(/four CTSO/);
      expect((await c.query("insert into public.pip_notes (pip_id, author_role, body, author_id) values ($1, 'teacher', 'Third meeting set for November 4.', $2)", [pipId, ids.teacherUserA1])).rowCount).toBe(1);
      await denied(c, "insert into public.pip_notes (pip_id, author_role, body, author_id) values ($1, 'director', 'x', $2)", [pipId, ids.teacherUserA1]);
    });
    const other = await withRole(p, { sub: ids.teacherUserA2 }, async (c) => ({ pips: (await c.query("select id from public.pips")).rowCount, goals: (await c.query("select id from public.pip_goals")).rowCount }));
    expect(other).toEqual({ pips: 0, goals: 0 });
    const leader = await withRole(p, { sub: ids.leadership }, async (c) => ({ pips: (await c.query("select status from public.pips")).rows, goals: (await c.query("select id from public.pip_goals")).rowCount, progress: (await c.query("select id from public.pip_progress")).rowCount }));
    expect(leader).toEqual({ pips: [{ status: "open" }], goals: 0, progress: 0 });
    const cluster = await withRole(p, { sub: ids.clusterAdmin }, async (c) => (await c.query("select id from public.pip_goals")).rowCount);
    expect(cluster).toBe(2);
  });

  it("escalations are recorded once at months 6, 9, and 11 while goals stay open, naming the cluster admin and the State Admin", async () => {
    const before = await asUser(p, { sub: ids.admin }, async (c) => (await c.query("select public.run_pip_escalations() as n")).rows[0].n);
    expect(before).toBe(0);
    await asOwner(p, (c) => c.query("update public.pips set starts_on = current_date - interval '9 months' - interval '2 days', due_on = current_date + interval '3 months' where id = $1", [pipId]));
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query("select public.run_pip_escalations()")));
    const first = await asUser(p, { sub: ids.admin }, async (c) => (await c.query("select public.run_pip_escalations() as n")).rows[0].n);
    const again = await asUser(p, { sub: ids.admin }, async (c) => (await c.query("select public.run_pip_escalations() as n")).rows[0].n);
    expect(first).toBe(2);
    expect(again).toBe(0);
    const rows = await asOwner(p, async (c) => (await c.query("select month, open_goals, notified from public.pip_escalations where pip_id = $1 order by month", [pipId])).rows);
    expect(rows.map((r) => [r.month, r.open_goals])).toEqual([[6, 2], [9, 2]]);
    expect(rows[0].notified).toEqual(expect.arrayContaining(["cluster@state.example.gov", "admin@state.example.gov"]));
    const director = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select month from public.pip_escalations")).rowCount);
    expect(director).toBe(2);
    // Goals accomplished: no month 11 escalation.
    await asUser(p, { sub: ids.reviewer1 }, (c) => c.query("update public.pip_goals set status = 'one_year', date_accomplished = current_date, updated_at = now() where pip_id = $1", [pipId]));
    await asOwner(p, (c) => c.query("update public.pips set starts_on = current_date - interval '11 months' - interval '2 days' where id = $1", [pipId]));
    const third = await asUser(p, { sub: ids.admin }, async (c) => (await c.query("select public.run_pip_escalations() as n")).rows[0].n);
    expect(third).toBe(0);
  });

  it("only the State Admin closes, with a note, and a closed PIP accepts no more changes", async () => {
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query("select app.close_pip($1, 'done')", [pipId])));
    await withRole(p, { sub: ids.admin }, async (c) => {
      await fails(c, "select app.close_pip($1, '')", [pipId], /note/);
    });
    await asUser(p, { sub: ids.admin }, (c) => c.query("select app.close_pip($1, 'All goals met; minutes and roster on file.')", [pipId]));
    const state = await asOwner(p, async (c) => (await c.query("select status, closed_by, close_note from public.pips where id = $1", [pipId])).rows[0]);
    expect(state).toEqual({ status: "closed", closed_by: ids.admin, close_note: "All goals met; minutes and roster on file." });
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      expect((await c.query("update public.pip_goals set action_steps = 'late' where pip_id = $1", [pipId])).rowCount).toBe(0);
      await denied(c, "insert into public.pip_progress (pip_id, month, body, entered_by) values ($1, 2, 'x', $2)", [pipId, ids.reviewer1]);
    });
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("insert into public.pip_notes (pip_id, author_role, body, author_id) values ($1, 'director', 'x', $2)", [pipId, ids.directorA])));
    const logged = await asOwner(p, async (c) => (await c.query("select action from public.audit_events where entity_id = $1 and action like 'pip.%' order by id", [pipId])).rows.map((r) => r.action));
    expect(logged).toEqual(["pip.created", "pip.escalated", "pip.escalated", "pip.closed"]);
  });
});
