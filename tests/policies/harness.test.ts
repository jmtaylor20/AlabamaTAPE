import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { asOwner, expectDenied, pool, withRole } from "./harness";

// Phase 0 smoke test: proves the local harness reproduces Supabase's
// auth functions, roles, and row-level security behavior.

let p: pg.Pool;
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

beforeAll(async () => {
  p = pool();
  await asOwner(p, async (c) => {
    await c.query(`
      create table public.smoke_notes (id serial primary key, owner uuid not null, body text not null);
      alter table public.smoke_notes enable row level security;
      grant select, insert on public.smoke_notes to authenticated;
      create policy smoke_owner_read on public.smoke_notes for select to authenticated
        using (app.has_mfa() and owner = auth.uid());
      insert into public.smoke_notes (owner, body) values ('${alice}', 'alice note'), ('${bob}', 'bob note');
    `);
  });
});

afterAll(async () => {
  await asOwner(p, (c) => c.query("drop table if exists public.smoke_notes"));
  await p.end();
});

describe("auth shim", () => {
  it("exposes the JWT subject through auth.uid()", async () => {
    const uid = await withRole(p, { sub: alice }, async (c) => (await c.query("select auth.uid() as uid")).rows[0].uid);
    expect(uid).toBe(alice);
  });

  it("reports aal from the claims", async () => {
    const aal = await withRole(p, { sub: alice, aal: "aal1" }, async (c) => (await c.query("select app.session_aal() as aal")).rows[0].aal);
    expect(aal).toBe("aal1");
  });
});

describe("row-level security", () => {
  it("lets a user with MFA read only their own rows", async () => {
    const rows = await withRole(p, { sub: alice }, async (c) => (await c.query("select body from public.smoke_notes order by id")).rows);
    expect(rows).toEqual([{ body: "alice note" }]);
  });

  it("returns nothing to a session without MFA", async () => {
    const rows = await withRole(p, { sub: alice, aal: "aal1" }, async (c) => (await c.query("select body from public.smoke_notes")).rows);
    expect(rows).toEqual([]);
  });

  it("denies the anonymous role entirely", async () => {
    await expectDenied(withRole(p, {}, (c) => c.query("select body from public.smoke_notes")));
  });

  it("denies writes that no policy allows", async () => {
    await expectDenied(withRole(p, { sub: alice }, (c) => c.query("insert into public.smoke_notes (owner, body) values ($1, 'x')", [alice])));
  });
});
