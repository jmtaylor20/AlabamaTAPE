import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Card, LinkButton, PageHeader } from "@/lib/ui";
import { roleLabel } from "@/lib/components/shell";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const supabase = await createUserClient();

  const [leas, teachers, year] = await Promise.all([
    supabase.from("leas").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("teachers").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("school_years").select("label").eq("is_current", true).maybeSingle(),
  ]);

  return (
    <>
      <PageHeader eyebrow={year.data?.label ?? "No current school year"} title={`Welcome, ${user.displayName}`} description={`Signed in as ${[...user.roles].map(roleLabel).join(", ") || "a user with no role"}.`} />
      {params.denied && <div className="mb-4"><Alert tone="warning">That page is not available for your role.</Alert></div>}
      {user.roles.size === 0 && <Alert tone="warning">Your account has no active role. Contact the TAPE coordinator.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Systems you can see">
          <p className="text-3xl font-semibold tabular-nums">{leas.count ?? 0}</p>
          <p className="text-sm text-ink-muted">active LEAs</p>
        </Card>
        <Card title="Teachers you can see">
          <p className="text-3xl font-semibold tabular-nums">{teachers.count ?? 0}</p>
          <p className="text-sm text-ink-muted">active teacher records</p>
        </Card>
        <Card title="What is built so far">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            <li>Invitation-only sign-in with authenticator app verification</li>
            <li>LEAs, schools, programs, clusters, teachers</li>
            <li>Roles, seats, and an append-only audit log</li>
            <li>The 2026-2027 instrument, locked once published</li>
            <li>Declarations with a one-time review window and a change history</li>
            <li>Cycles, nominations, the seeded random draw, scheduling, and embargoed release</li>
          </ul>
          <p className="mt-3 text-sm text-ink-muted">Next: evidence upload and Director self-scoring.</p>
        </Card>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {user.leaIds.length > 0 && <LinkButton href="/app/lea">Open my LEA</LinkButton>}
        {user.isStaff && <LinkButton href="/app/reviews">Reviews</LinkButton>}
        {user.isStateAdmin && <LinkButton href="/app/admin/cycles">Cycles</LinkButton>}
        {user.isStateAdmin && <LinkButton href="/app/admin/leas">Manage LEAs</LinkButton>}
        {user.isStateAdmin && <LinkButton href="/app/admin/users">Manage users</LinkButton>}
      </div>
    </>
  );
}
