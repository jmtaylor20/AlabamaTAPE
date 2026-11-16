import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, asUser, expectDenied, pool, withRole } from "./harness";

/** Phase 7 tests: the rate limiter, retention reporting, and the count functions leadership reads instead of records. */

let p: pg.Pool;
const ids = { leaA: "abababab-0000-4000-8000-00000000000a", admin: "70000000-0000-4000-8000-000000000001", leadership: "70000000-0000-4000-8000-000000000003", directorA: "70000000-0000-4000-8000-00000000000a" };

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    await c.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true)");
    await c.query("select app.seed_retention_policies()");
    await c.query(`
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '908', 'Hickory Flats County');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'hickoryflats.example.edu'), (null, 'state.example.gov');
      insert into public.invitations (email, role, lea_id) values ('admin@state.example.gov', 'state_admin', null), ('leader@state.example.gov', 'leadership', null), ('director@hickoryflats.example.edu', 'cte_director', '${ids.leaA}');
    `);
    for (const [id, email] of [[ids.admin, "admin@state.example.gov"], [ids.leadership, "leader@state.example.gov"], [ids.directorA, "director@hickoryflats.example.edu"]]) await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
  });
});

afterAll(async () => {
  await asOwner(p, (c) => c.query("truncate public.audit_events, public.rate_limits, public.invitations, public.role_grants, public.profiles, public.approved_domains, public.leas, public.school_years, auth.users restart identity cascade"));
  await p.end();
});

describe("operations", () => {
  it("the rate limiter allows a burst up to the limit, then refuses until the window passes, and works without a session", async () => {
    const results = await withRole(p, { role: "anon" }, async (c) => {
      const out: boolean[] = [];
      for (let i = 0; i < 5; i++) out.push((await c.query("select public.consume_rate_limit('test:key', 3, 60) as ok")).rows[0].ok);
      return out;
    });
    expect(results).toEqual([true, true, true, false, false]);
    await asOwner(p, (c) => c.query("insert into public.rate_limits (key, window_start, hits) values ('test:old', now() - interval '2 minutes', 99)"));
    const reset = await withRole(p, { role: "anon" }, async (c) => (await c.query("select public.consume_rate_limit('test:old', 3, 60) as ok")).rows[0].ok);
    expect(reset).toBe(true);
    await expectDenied(withRole(p, { role: "anon" }, (c) => c.query("select key from public.rate_limits")));
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("select key from public.rate_limits")));
  });

  it("retention policies are State Admin only, configurable, and reported as eligibility counts", async () => {
    const director = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select record_class from public.retention_policies")).rowCount);
    expect(director).toBe(0);
    const leader = await withRole(p, { sub: ids.leadership }, async (c) => (await c.query("select * from public.retention_report()")).rowCount);
    expect(leader).toBe(0);
    await asUser(p, { sub: ids.admin }, async (c) => {
      const before = (await c.query("select years from public.retention_policies where record_class = 'evidence_files'")).rows[0].years;
      expect(before).toBe(5);
      await c.query("update public.retention_policies set years = 6, updated_by = $1 where record_class = 'evidence_files'", [ids.admin]);
      const report = (await c.query("select record_class, years, total, eligible from public.retention_report()")).rows;
      expect(report.find((r) => r.record_class === "evidence_files")).toMatchObject({ years: 6, total: "0", eligible: "0" });
      expect(report).toHaveLength(7);
    });
    const logged = await asOwner(p, async (c) => (await c.query("select count(*)::int as n from public.audit_events where entity_type = 'retention_policies'")).rows[0].n);
    expect(logged).toBe(1);
  });

  it("leadership reads counts, not records", async () => {
    const leader = await withRole(p, { sub: ids.leadership }, async (c) => ({
      counts: (await c.query("select * from public.review_counts()")).rowCount,
      findings: (await c.query("select * from public.finding_counts()")).rowCount,
      rows: (await c.query("select id from public.findings")).rowCount,
    }));
    expect(leader).toEqual({ counts: 0, findings: 0, rows: 0 });
    const director = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select * from public.finding_counts()")).rowCount);
    expect(director).toBe(0);
  });
});
