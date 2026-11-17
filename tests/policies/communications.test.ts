import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, asUser, denied, expectDenied, fails, pool, withRole } from "./harness";
import { instrumentSql } from "../../scripts/db/seed-instrument.mjs";

/**
 * Phase 6 tests: before release no district draft carries a selected program,
 * a reviewer's name or address, or the visit dates, and the notification
 * itself cannot be drafted at all; staff-only templates never carry a
 * district address; recipients resolve from the records with pairing
 * expansion; drafts are read in scope and approved and sent only by the
 * State Admin.
 */

let p: pg.Pool;
const ids = {
  leaA: "ffffffff-0000-4000-8000-00000000000a",
  schoolA: "ffffffff-0000-4000-8000-00000000001a",
  teacherA1: "ffffffff-0000-4000-8000-00000000002a",
  admin: "60000000-0000-4000-8000-000000000001",
  reviewer1: "60000000-0000-4000-8000-000000000002",
  reviewer2: "60000000-0000-4000-8000-000000000004",
  clusterAdmin: "60000000-0000-4000-8000-000000000005",
  leadership: "60000000-0000-4000-8000-000000000003",
  directorA: "60000000-0000-4000-8000-00000000000a",
  teacherUserA1: "60000000-0000-4000-8000-00000000002a",
};
let yearId = "";
let reviewA = "";
let pr10 = "";

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    yearId = (await c.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true) returning id")).rows[0].id;
    await c.query(`
      insert into public.clusters (code, name) values ('01', 'Agriculture');
      insert into public.program_catalog (code, name, cluster_code, is_coop) values ('10', 'Aquaculture Science', '01', false);
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '907', 'Sycamore Ridge County');
      insert into public.schools (id, lea_id, school_code, name) values ('${ids.schoolA}', '${ids.leaA}', '0050', 'Sycamore Ridge High School');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'sycamoreridge.example.edu'), (null, 'state.example.gov');
      insert into public.teachers (id, lea_id, display_name, email) values ('${ids.teacherA1}', '${ids.leaA}', 'Perrin Oakhurst', 'perrin.oakhurst@sycamoreridge.example.edu');
      insert into public.lea_contacts (lea_id, contact_role, display_name, email) values ('${ids.leaA}', 'cte_director', 'Director Contact', 'director@sycamoreridge.example.edu');
      insert into public.invitations (email, display_name, role, lea_id, cluster_code, teacher_id) values
        ('admin@state.example.gov', 'State Admin', 'state_admin', null, null, null), ('reviewer1@state.example.gov', 'Reviewer One', 'reviewer', null, null, null), ('reviewer2@state.example.gov', 'Reviewer Two', 'reviewer', null, null, null),
        ('cluster@state.example.gov', 'Cluster Admin', 'cluster_admin', null, '01', null), ('leader@state.example.gov', 'Leader', 'leadership', null, null, null), ('director@sycamoreridge.example.edu', 'Director Contact', 'cte_director', '${ids.leaA}', null, null),
        ('perrin.oakhurst@sycamoreridge.example.edu', 'Perrin Oakhurst', 'teacher', '${ids.leaA}', null, '${ids.teacherA1}');
    `);
    for (const [id, email] of [[ids.admin, "admin@state.example.gov"], [ids.reviewer1, "reviewer1@state.example.gov"], [ids.reviewer2, "reviewer2@state.example.gov"], [ids.clusterAdmin, "cluster@state.example.gov"], [ids.leadership, "leader@state.example.gov"], [ids.directorA, "director@sycamoreridge.example.edu"], [ids.teacherUserA1, "perrin.oakhurst@sycamoreridge.example.edu"]])
      await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await c.query(instrumentSql());
    await c.query("select app.seed_default_templates()");
    const cycleId = (await c.query("insert into public.review_cycles (school_year_id, name) values ($1, '2026-2027 TAPE') returning id", [yearId])).rows[0].id;
    const dp10 = (await c.query("insert into public.declared_programs (lea_id, school_year_id, home_school_id, program_code) values ($1, $2, $3, '10') returning id", [ids.leaA, yearId, ids.schoolA])).rows[0].id;
    await c.query("insert into public.declared_program_teachers (declared_program_id, teacher_id) values ($1, $2)", [dp10, ids.teacherA1]);
    reviewA = (await c.query("insert into public.lea_reviews (cycle_id, lea_id, review_month, review_year, visit_start, visit_end) values ($1, $2, 2, 2027, '2027-02-16', '2027-02-17') returning id", [cycleId, ids.leaA])).rows[0].id;
    await c.query("insert into public.selections (lea_review_id, declared_program_id, method) values ($1, $2, 'manual')", [reviewA, dp10]);
    // Wherever Reviewer One is included, Reviewer Two is included.
    await c.query("insert into public.staff_pairings (person_a, person_b, reason) values ($1, $2, 'shadowing')", [ids.reviewer1, ids.reviewer2]);
  });
  await asUser(p, { sub: ids.admin }, async (c) => {
    await c.query("select app.materialize_program_reviews($1)", [reviewA]);
    pr10 = (await c.query("select id from public.program_reviews where lea_review_id = $1", [reviewA])).rows[0].id;
    await c.query("insert into public.review_assignments (program_review_id, user_id, email, display_name, assignment_role, assigned_by) values ($1, $2, 'reviewer1@state.example.gov', 'Reviewer One', 'lead_reviewer', $3), ($1, $4, 'cluster@state.example.gov', 'Cluster Admin', 'cluster_admin', $3)", [pr10, ids.reviewer1, ids.admin, ids.clusterAdmin]);
  });
});

afterAll(async () => {
  await asOwner(p, (c) =>
    c.query(`truncate public.audit_events, public.email_drafts, public.email_templates, public.pip_escalations, public.pip_notes, public.pip_progress, public.pip_goals, public.pips, public.finalizations, public.findings, public.consistency_meetings, public.desk_audits, public.onsite_checks, public.audit_samples, public.section_comments, public.epic_scores,
      public.score_entries, public.credential_results, public.form_141_items, public.form_141, public.evidence_access, public.evidence_qpi_links, public.evidence_files,
      public.scope_changes, public.review_assignments, public.program_review_site_teachers, public.program_review_sites, public.program_reviews, public.selections, public.selection_draws,
      public.milestones, public.lea_reviews, public.declaration_revisions, public.declaration_windows, public.declared_program_teachers, public.declared_programs, public.declaration_imports, public.compliance_list, public.review_cycles, public.lea_contacts,
      public.checklist_items, public.scoring_rules, public.epic_descriptors, public.qpi_subitems, public.qpis, public.instrument_sections, public.instrument_versions,
      public.staff_pairings, public.invitations, public.teacher_years, public.teachers, public.role_grants, public.profiles, public.holidays, public.approved_domains, public.schools, public.leas, public.program_catalog, public.clusters, public.school_years, auth.users restart identity cascade`),
  );
  await p.end();
});

describe("embargo in communications", () => {
  it("before release, the notification cannot be drafted and the check-in carries nothing embargoed", async () => {
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("select app.generate_draft('notification', $1)", [reviewA])));
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("select app.generate_draft('evidence_reminder', $1)", [reviewA])));
    const draft = await asUser(p, { sub: ids.admin }, async (c) => {
      const id = (await c.query("select app.generate_draft('check_in', $1) as id", [reviewA])).rows[0].id;
      return (await c.query("select subject, body, to_list, cc_list, merge, audience from public.email_drafts where id = $1", [id])).rows[0];
    });
    expect(draft.to_list).toEqual(["director@sycamoreridge.example.edu"]);
    expect(draft.cc_list).toEqual(["admin@state.example.gov"]);
    const text = `${draft.subject}\n${draft.body}`.toLowerCase();
    expect(text).not.toContain("aquaculture");
    expect(text).not.toContain("reviewer1@");
    expect(text).not.toContain("reviewer one");
    expect(text).not.toContain("february 16");
    expect(text).toContain("february 2027");
    expect(draft.merge).not.toHaveProperty("programs_table");
    expect(draft.merge).not.toHaveProperty("visit_dates");
    expect(draft.body).not.toContain("{{");
    // Even the State Admin cannot slip a program name into a pre-release district draft by editing it.
    await withRole(p, { sub: ids.admin }, async (c) => {
      await denied(c, "update public.email_drafts set body = body || ' Aquaculture Science is selected.' where step_key = 'check_in'");
      await denied(c, "update public.email_drafts set body = body || ' Your reviewer is reviewer1@state.example.gov.' where step_key = 'check_in'");
      await denied(c, "update public.email_drafts set body = body || ' Visit February 16, 2027.' where step_key = 'check_in'");
    });
  });

  it("a staff-only message never carries a district address, even by edit", async () => {
    const draft = await asUser(p, { sub: ids.admin }, async (c) => {
      const id = (await c.query("select app.generate_draft('reviewer_assignment', $1) as id", [reviewA])).rows[0].id;
      return (await c.query("select id, to_list, cc_list, body from public.email_drafts where id = $1", [id])).rows[0];
    });
    expect(draft.to_list).toEqual(expect.arrayContaining(["reviewer1@state.example.gov", "reviewer2@state.example.gov"]));
    expect(draft.cc_list).toEqual(expect.arrayContaining(["cluster@state.example.gov", "admin@state.example.gov"]));
    expect([...draft.to_list, ...draft.cc_list].some((e: string) => e.endsWith("example.edu"))).toBe(false);
    expect(draft.body).toContain("Aquaculture Science");
    await withRole(p, { sub: ids.admin }, async (c) => {
      await denied(c, "update public.email_drafts set cc_list = cc_list || '[\"director@sycamoreridge.example.edu\"]'::jsonb where id = $1", [draft.id]);
      await denied(c, "update public.email_drafts set to_list = '[\"someone@sycamoreridge.example.edu\"]'::jsonb where id = $1", [draft.id]);
      await denied(c, "update public.email_drafts set cc_list = cc_list || '[\"perrin.oakhurst@sycamoreridge.example.edu\"]'::jsonb where id = $1", [draft.id]);
    });
  });

  it("after release, the notification carries programs, reviewers, teachers, key dates, and the paired person", async () => {
    await asUser(p, { sub: ids.admin }, (c) => c.query("select app.release_notification($1)", [reviewA]));
    const draft = await asUser(p, { sub: ids.reviewer1 }, async (c) => {
      const id = (await c.query("select app.generate_draft('notification', $1) as id", [reviewA])).rows[0].id;
      return (await c.query("select subject, body, to_list, cc_list, generated_by from public.email_drafts where id = $1", [id])).rows[0];
    });
    expect(draft.to_list).toEqual(["director@sycamoreridge.example.edu"]);
    expect(draft.cc_list).toEqual(expect.arrayContaining(["reviewer1@state.example.gov", "reviewer2@state.example.gov", "cluster@state.example.gov", "perrin.oakhurst@sycamoreridge.example.edu", "admin@state.example.gov"]));
    expect(draft.cc_list).not.toContain("director@sycamoreridge.example.edu");
    expect(draft.subject).toBe("TAPE Review Notification: Sycamore Ridge County, February 16 to February 17, 2027");
    expect(draft.body).toContain("Aquaculture Science: Reviewer One (reviewer1@state.example.gov)");
    expect(draft.body).toContain("Perrin Oakhurst (perrin.oakhurst@sycamoreridge.example.edu)");
    expect(draft.body).toContain("Sycamore Ridge High School");
    expect(draft.body).toContain("February 1, 2027");
    expect(draft.body).not.toContain("{{");
    expect(draft.generated_by).toBe(ids.reviewer1);
  });
});

describe("drafts: who reads, who approves, who sends", () => {
  it("assigned reviewers and the cluster admin read drafts; district roles, leadership, and an unassigned reviewer do not", async () => {
    const count = (sub: string) => withRole(p, { sub }, async (c) => (await c.query("select id from public.email_drafts")).rowCount);
    expect(await count(ids.admin)).toBe(3);
    expect(await count(ids.reviewer1)).toBe(3);
    expect(await count(ids.clusterAdmin)).toBe(3);
    expect(await count(ids.reviewer2)).toBe(0);
    expect(await count(ids.directorA)).toBe(0);
    expect(await count(ids.teacherUserA1)).toBe(0);
    expect(await count(ids.leadership)).toBe(0);
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("select app.generate_draft('check_in', $1)", [reviewA])));
    await expectDenied(withRole(p, { sub: ids.reviewer2 }, (c) => c.query("select app.generate_draft('check_in', $1)", [reviewA])));
    const templates = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select id from public.email_templates")).rowCount);
    expect(templates).toBe(0);
    const edited = await withRole(p, { sub: ids.reviewer1 }, async (c) => (await c.query("update public.email_templates set subject = 'x' where step_key = 'check_in'")).rowCount);
    expect(edited).toBe(0);
  });

  it("only the State Admin approves and marks sent; a reviewer can discard their own draft", async () => {
    const id = await asOwner(p, async (c) => (await c.query("select id from public.email_drafts where step_key = 'notification'")).rows[0].id);
    await expectDenied(withRole(p, { sub: ids.reviewer1 }, (c) => c.query("select app.approve_draft($1)", [id])));
    await withRole(p, { sub: ids.admin }, async (c) => {
      await fails(c, "select app.mark_draft_sent($1, 'msg_1', null)", [id], /approved/);
    });
    await asUser(p, { sub: ids.admin }, (c) => c.query("select app.approve_draft($1)", [id]));
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      expect((await c.query("update public.email_drafts set body = 'changed' where id = $1", [id])).rowCount).toBe(0);
    });
    await asUser(p, { sub: ids.admin }, (c) => c.query("select app.mark_draft_sent($1, 'msg_1', null)", [id]));
    const sent = await asOwner(p, async (c) => (await c.query("select status, provider_message_id, sent_by from public.email_drafts where id = $1", [id])).rows[0]);
    expect(sent).toEqual({ status: "sent", provider_message_id: "msg_1", sent_by: ids.admin });
    const mine = await asOwner(p, async (c) => (await c.query("select id from public.email_drafts where step_key = 'check_in'")).rows[0].id);
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      expect((await c.query("update public.email_drafts set status = 'discarded', discard_reason = 'superseded' where id = $1", [mine])).rowCount).toBe(0);
    });
    const own = await asUser(p, { sub: ids.reviewer1 }, async (c) => (await c.query("select app.generate_draft('evidence_reminder', $1) as id", [reviewA])).rows[0].id);
    await withRole(p, { sub: ids.reviewer1 }, async (c) => {
      expect((await c.query("update public.email_drafts set status = 'discarded', discard_reason = 'superseded' where id = $1", [own])).rowCount).toBe(1);
    });
    const logged = await asOwner(p, async (c) => (await c.query("select action from public.audit_events where entity_id = $1 and action like 'email.%' order by id", [id])).rows.map((r) => r.action));
    expect(logged).toEqual(["email.drafted", "email.approved", "email.sent"]);
  });
});
