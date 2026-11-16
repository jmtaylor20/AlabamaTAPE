import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, expectDenied, pool, withRole } from "./harness";

/**
 * Phase 1 permission tests. These prove, against the real migrations and
 * policies, that a Director cannot read another LEA, a Teacher cannot read
 * other teachers, a deactivated account reads nothing, a session without MFA
 * reads nothing, sign-up requires an invitation on an approved domain, and
 * the audit log cannot be altered.
 */

let p: pg.Pool;

const ids = {
  leaA: "aaaaaaaa-0000-4000-8000-00000000000a",
  leaB: "bbbbbbbb-0000-4000-8000-00000000000b",
  schoolA: "aaaaaaaa-0000-4000-8000-00000000001a",
  schoolB: "bbbbbbbb-0000-4000-8000-00000000001b",
  teacherA1: "aaaaaaaa-0000-4000-8000-00000000002a",
  teacherA2: "aaaaaaaa-0000-4000-8000-00000000003a",
  teacherB1: "bbbbbbbb-0000-4000-8000-00000000002b",
  admin: "10000000-0000-4000-8000-000000000001",
  directorA: "10000000-0000-4000-8000-00000000000a",
  directorB: "10000000-0000-4000-8000-00000000000b",
  staffA: "10000000-0000-4000-8000-00000000001a",
  teacherUserA1: "10000000-0000-4000-8000-00000000002a",
  reviewer: "10000000-0000-4000-8000-000000000002",
  leadership: "10000000-0000-4000-8000-000000000003",
  deactivated: "10000000-0000-4000-8000-000000000009",
};

async function signUp(c: pg.PoolClient, id: string, email: string) {
  await c.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
}

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    await c.query(`
      insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true);
      insert into public.clusters (code, name) values ('01', 'Agriculture');
      insert into public.program_catalog (code, name, cluster_code) values ('10', 'General Agriculture', '01');
      insert into public.leas (id, system_code, name) values ('${ids.leaA}', '901', 'Riverbend County'), ('${ids.leaB}', '902', 'Pine Ridge City');
      insert into public.schools (id, lea_id, school_code, name) values ('${ids.schoolA}', '${ids.leaA}', '0010', 'Riverbend High School'), ('${ids.schoolB}', '${ids.leaB}', '0010', 'Pine Ridge High School');
      insert into public.approved_domains (lea_id, domain) values ('${ids.leaA}', 'riverbend.example.edu'), ('${ids.leaB}', 'pineridge.example.edu'), (null, 'state.example.gov');
      insert into public.teachers (id, lea_id, display_name, email) values
        ('${ids.teacherA1}', '${ids.leaA}', 'Avery Abernathy', 'avery.abernathy@riverbend.example.edu'),
        ('${ids.teacherA2}', '${ids.leaA}', 'Jordan Blackwood', 'jordan.blackwood@riverbend.example.edu'),
        ('${ids.teacherB1}', '${ids.leaB}', 'Riley Calloway', 'riley.calloway@pineridge.example.edu');
      insert into public.invitations (email, role, lea_id, cluster_code, teacher_id) values
        ('admin@state.example.gov', 'state_admin', null, null, null),
        ('reviewer@state.example.gov', 'reviewer', null, null, null),
        ('leader@state.example.gov', 'leadership', null, null, null),
        ('director@riverbend.example.edu', 'cte_director', '${ids.leaA}', null, null),
        ('staff@riverbend.example.edu', 'lea_staff', '${ids.leaA}', null, null),
        ('avery.abernathy@riverbend.example.edu', 'teacher', '${ids.leaA}', null, '${ids.teacherA1}'),
        ('director@pineridge.example.edu', 'cte_director', '${ids.leaB}', null, null),
        ('former@riverbend.example.edu', 'cte_director', '${ids.leaA}', null, null),
        ('wrongdomain@state.example.gov', 'cte_director', '${ids.leaA}', null, null);
    `);
    await signUp(c, ids.admin, "admin@state.example.gov");
    await signUp(c, ids.reviewer, "reviewer@state.example.gov");
    await signUp(c, ids.leadership, "leader@state.example.gov");
    await signUp(c, ids.directorA, "director@riverbend.example.edu");
    await signUp(c, ids.staffA, "staff@riverbend.example.edu");
    await signUp(c, ids.teacherUserA1, "avery.abernathy@riverbend.example.edu");
    await signUp(c, ids.directorB, "director@pineridge.example.edu");
    await signUp(c, ids.deactivated, "former@riverbend.example.edu");
    await c.query("update public.profiles set status = 'deactivated', deactivated_at = now() where id = $1", [ids.deactivated]);
  });
});

afterAll(async () => {
  await asOwner(p, (c) =>
    c.query(`truncate public.audit_events, public.staff_pairings, public.invitations, public.teacher_years, public.teachers, public.role_grants, public.profiles,
      public.holidays, public.approved_domains, public.schools, public.leas, public.program_catalog, public.clusters, public.school_years, auth.users restart identity cascade`),
  );
  await p.end();
});

describe("sign-up gate", () => {
  it("rejects a user who was not invited", async () => {
    await asOwner(p, async (c) => {
      await expect(signUp(c, "20000000-0000-4000-8000-000000000001", "nobody@riverbend.example.edu")).rejects.toMatchObject({ code: "28000" });
    });
  });

  it("rejects an invited user whose email domain is not approved for the LEA", async () => {
    await asOwner(p, async (c) => {
      await expect(signUp(c, "20000000-0000-4000-8000-000000000002", "wrongdomain@state.example.gov")).rejects.toMatchObject({ code: "28000" });
    });
  });

  it("creates a profile and role grant from an accepted invitation", async () => {
    const rows = await asOwner(p, async (c) =>
      (await c.query(`select p.status, g.role, g.lea_id, i.accepted_at is not null as accepted, t.profile_id
        from public.profiles p join public.role_grants g on g.user_id = p.id
        join public.invitations i on i.accepted_user_id = p.id
        left join public.teachers t on t.profile_id = p.id where p.id = $1`, [ids.teacherUserA1])).rows,
    );
    expect(rows).toEqual([{ status: "active", role: "teacher", lea_id: ids.leaA, accepted: true, profile_id: ids.teacherUserA1 }]);
  });
});

describe("LEA isolation", () => {
  it("a Director reads schools and teachers in their own LEA only", async () => {
    const seen = await withRole(p, { sub: ids.directorA }, async (c) => ({
      leas: (await c.query("select system_code from public.leas order by 1")).rows.map((r) => r.system_code),
      schools: (await c.query("select name from public.schools order by 1")).rows.map((r) => r.name),
      teachers: (await c.query("select display_name from public.teachers order by 1")).rows.map((r) => r.display_name),
    }));
    expect(seen).toEqual({ leas: ["901"], schools: ["Riverbend High School"], teachers: ["Avery Abernathy", "Jordan Blackwood"] });
  });

  it("a Director cannot read another LEA's records even by primary key", async () => {
    const rows = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select id from public.teachers where id = $1", [ids.teacherB1])).rows);
    expect(rows).toEqual([]);
  });

  it("a Director can add a teacher to their own LEA but not to another LEA", async () => {
    await withRole(p, { sub: ids.directorA }, async (c) => {
      const ok = await c.query("insert into public.teachers (lea_id, display_name) values ($1, 'New Teacher') returning id", [ids.leaA]);
      expect(ok.rowCount).toBe(1);
    });
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("insert into public.teachers (lea_id, display_name) values ($1, 'Intruder')", [ids.leaB])));
  });

  it("a Director cannot change a teacher in another LEA", async () => {
    const updated = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("update public.teachers set display_name = 'Changed' where id = $1", [ids.teacherB1])).rowCount);
    expect(updated).toBe(0);
  });

  it("a Director can invite a teacher for their own LEA only, and only district roles", async () => {
    await withRole(p, { sub: ids.directorA }, async (c) => {
      const ok = await c.query("insert into public.invitations (email, role, lea_id, invited_by) values ('new.teacher@riverbend.example.edu', 'teacher', $1, $2) returning id", [ids.leaA, ids.directorA]);
      expect(ok.rowCount).toBe(1);
    });
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("insert into public.invitations (email, role, lea_id, invited_by) values ('x@pineridge.example.edu', 'teacher', $1, $2)", [ids.leaB, ids.directorA])));
    await expectDenied(withRole(p, { sub: ids.directorA }, (c) => c.query("insert into public.invitations (email, role, invited_by) values ('x@state.example.gov', 'state_admin', $1)", [ids.directorA])));
  });

  it("a Director sees role grants and profiles for their LEA only", async () => {
    const seen = await withRole(p, { sub: ids.directorA }, async (c) => ({
      grants: (await c.query("select distinct lea_id from public.role_grants where lea_id is not null")).rows.map((r) => r.lea_id),
      profiles: (await c.query("select email from public.profiles order by 1")).rows.map((r) => r.email),
    }));
    expect(seen.grants).toEqual([ids.leaA]);
    expect(seen.profiles).toEqual(["avery.abernathy@riverbend.example.edu", "director@riverbend.example.edu", "former@riverbend.example.edu", "staff@riverbend.example.edu"]);
  });

  it("LEA staff can edit teachers but cannot invite", async () => {
    const updated = await withRole(p, { sub: ids.staffA }, async (c) => (await c.query("update public.teachers set display_name = 'Jordan B. Blackwood' where id = $1", [ids.teacherA2])).rowCount);
    expect(updated).toBe(1);
    await expectDenied(withRole(p, { sub: ids.staffA }, (c) => c.query("insert into public.invitations (email, role, lea_id, invited_by) values ('t@riverbend.example.edu', 'teacher', $1, $2)", [ids.leaA, ids.staffA])));
  });
});

describe("Teacher scope", () => {
  it("a Teacher reads only their own teacher record", async () => {
    const rows = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => (await c.query("select display_name from public.teachers order by 1")).rows.map((r) => r.display_name));
    expect(rows).toEqual(["Avery Abernathy"]);
  });

  it("a Teacher cannot read invitations, other profiles, or approved domains", async () => {
    const seen = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => ({
      invitations: (await c.query("select id from public.invitations")).rowCount,
      profiles: (await c.query("select email from public.profiles")).rows.map((r) => r.email),
      domains: (await c.query("select id from public.approved_domains")).rowCount,
    }));
    expect(seen).toEqual({ invitations: 0, profiles: ["avery.abernathy@riverbend.example.edu"], domains: 0 });
  });

  it("a Teacher cannot change their own record", async () => {
    const updated = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => (await c.query("update public.teachers set display_name = 'Hacked' where id = $1", [ids.teacherA1])).rowCount);
    expect(updated).toBe(0);
  });
});

describe("staff scope", () => {
  it("a Reviewer reads every LEA's teachers but cannot edit them", async () => {
    const names = await withRole(p, { sub: ids.reviewer }, async (c) => (await c.query("select count(*)::int as n from public.teachers")).rows[0].n);
    expect(names).toBe(3);
    const updated = await withRole(p, { sub: ids.reviewer }, async (c) => (await c.query("update public.teachers set display_name = 'x' where id = $1", [ids.teacherA1])).rowCount);
    expect(updated).toBe(0);
  });

  it("Leadership reads LEAs but not invitations or role grants of others", async () => {
    const seen = await withRole(p, { sub: ids.leadership }, async (c) => ({
      leas: (await c.query("select count(*)::int as n from public.leas")).rows[0].n,
      invitations: (await c.query("select count(*)::int as n from public.invitations")).rows[0].n,
      grants: (await c.query("select count(*)::int as n from public.role_grants where user_id <> $1", [ids.leadership])).rows[0].n,
    }));
    expect(seen).toEqual({ leas: 2, invitations: 0, grants: 0 });
  });

  it("the State Admin reads and edits everything", async () => {
    const result = await withRole(p, { sub: ids.admin }, async (c) => ({
      teachers: (await c.query("select count(*)::int as n from public.teachers")).rows[0].n,
      updated: (await c.query("update public.leas set name = 'Pine Ridge City Schools' where id = $1", [ids.leaB])).rowCount,
    }));
    expect(result.teachers).toBe(3);
    expect(result.updated).toBe(1);
  });
});

describe("session requirements", () => {
  it("a deactivated account reads nothing, immediately", async () => {
    const seen = await withRole(p, { sub: ids.deactivated }, async (c) => ({
      schools: (await c.query("select id from public.schools")).rowCount,
      teachers: (await c.query("select id from public.teachers")).rowCount,
      self: (await c.query("select id from public.profiles")).rowCount,
    }));
    expect(seen).toEqual({ schools: 0, teachers: 0, self: 0 });
  });

  it("a session without MFA reads nothing, even for the State Admin", async () => {
    const seen = await withRole(p, { sub: ids.admin, aal: "aal1" }, async (c) => ({
      leas: (await c.query("select id from public.leas")).rowCount,
      profiles: (await c.query("select id from public.profiles")).rowCount,
      catalog: (await c.query("select code from public.program_catalog")).rowCount,
    }));
    expect(seen).toEqual({ leas: 0, profiles: 0, catalog: 0 });
  });

  it("a revoked grant stops access", async () => {
    await asOwner(p, (c) => c.query("update public.role_grants set revoked_at = now() where user_id = $1", [ids.directorB]));
    const seen = await withRole(p, { sub: ids.directorB }, async (c) => (await c.query("select id from public.schools")).rowCount);
    expect(seen).toBe(0);
    await asOwner(p, (c) => c.query("update public.role_grants set revoked_at = null where user_id = $1", [ids.directorB]));
  });
});

describe("audit log", () => {
  it("records row changes with the acting user, and the actor can read them", async () => {
    const rows = await withRole(p, { sub: ids.directorA }, async (c) => {
      const inserted = await c.query("insert into public.teachers (lea_id, display_name) values ($1, 'Audited Teacher') returning id", [ids.leaA]);
      return (await c.query("select actor_id, action, lea_id, after ->> 'display_name' as name from public.audit_events where entity_type = 'teachers' and entity_id = $1", [inserted.rows[0].id])).rows;
    });
    expect(rows).toEqual([{ actor_id: ids.directorA, action: "teachers.insert", lea_id: ids.leaA, name: "Audited Teacher" }]);
  });

  it("records application events for the caller only", async () => {
    const row = await withRole(p, { sub: ids.reviewer }, async (c) => {
      const id = (await c.query("select app.log_event('auth.sign_in', 'profiles', $1, null, '{\"method\":\"totp\"}') as id", [ids.reviewer])).rows[0].id;
      return (await c.query("select actor_id, action, meta from public.audit_events where id = $1", [id])).rows[0];
    });
    expect(row).toEqual({ actor_id: ids.reviewer, action: "auth.sign_in", meta: { method: "totp" } });
  });

  it("cannot be updated or deleted by anyone, including the State Admin and the owner", async () => {
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("delete from public.audit_events where id = (select min(id) from public.audit_events)")));
    await expectDenied(withRole(p, { sub: ids.admin }, (c) => c.query("update public.audit_events set action = 'x' where id = (select min(id) from public.audit_events)")));
    await asOwner(p, async (c) => {
      await expect(c.query("delete from public.audit_events where id = (select min(id) from public.audit_events)")).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("is readable by the State Admin in full, by a Director for their LEA only, and by a Teacher for their own actions only", async () => {
    const admin = await withRole(p, { sub: ids.admin }, async (c) => (await c.query("select count(*)::int as n from public.audit_events")).rows[0].n);
    const director = await withRole(p, { sub: ids.directorA }, async (c) => (await c.query("select distinct lea_id from public.audit_events where lea_id is not null")).rows.map((r) => r.lea_id));
    const teacher = await withRole(p, { sub: ids.teacherUserA1 }, async (c) => (await c.query("select distinct actor_id from public.audit_events")).rows.map((r) => r.actor_id));
    expect(admin).toBeGreaterThan(10);
    expect(director).toEqual([ids.leaA]);
    expect(teacher).toEqual([ids.teacherUserA1]);
  });
});
