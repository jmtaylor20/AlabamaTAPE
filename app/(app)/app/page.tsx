import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { roleLabel } from "@/lib/components/shell";
import { fmtDate, monthName, statusLabel, todayIso } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Card, Empty, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Home" };

type Count = { lea_id: string; lea_name: string; program_code: string; program_name: string; cluster_code: string; review_month: number; review_year: number; status: string; released: boolean; finalized: boolean; level2: number; level1: number; na: number; open_findings: number; cleared_findings: number; pip_status: string | null; pip_due: string | null };
type FindingCount = { qpi_code: string; open_count: number; cleared_count: number };

/** The dashboard. Every number comes from queries under the caller's own policies, so each role sees its own slice. */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const supabase = await createUserClient();
  const { data: year } = await supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle();
  const today = todayIso();
  const [counts, findings, { data: upcoming }, { data: drafts }, { data: pips }, { data: files }] = await Promise.all([
    supabase.rpc("review_counts", { p_school_year: year?.id ?? null }) as unknown as Promise<{ data: Count[] | null }>,
    supabase.rpc("finding_counts", { p_school_year: year?.id ?? null }) as unknown as Promise<{ data: FindingCount[] | null }>,
    supabase.from("calendar_items").select("*").gte("on_date", today).order("on_date").limit(12),
    user.isStaff ? supabase.from("email_drafts").select("id, status").in("status", ["draft", "approved"]) : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    supabase.from("pips").select("id, status, due_on"),
    user.isStaff ? Promise.resolve({ data: [] as { scan_status: string }[] }) : supabase.from("evidence_files").select("scan_status").is("removed_at", null),
  ]);
  const rows = counts.data ?? [];
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  const scored = rows.filter((r) => r.finalized);
  const level2 = scored.reduce((n, r) => n + Number(r.level2), 0);
  const level1 = scored.reduce((n, r) => n + Number(r.level1), 0);
  const openFindings = rows.reduce((n, r) => n + Number(r.open_findings), 0);
  const openPips = (pips ?? []).filter((p) => p.status === "open");
  const overduePips = openPips.filter((p) => p.due_on < today);
  const leadershipOnly = user.roles.has("leadership") && !user.isStateAdmin;
  const isDistrict = user.leaIds.length > 0;

  return (
    <>
      <PageHeader eyebrow={year?.label ?? "No current school year"} title={`Welcome, ${user.displayName}`} description={`Signed in as ${[...user.roles].map(roleLabel).join(", ") || "a user with no role"}.`}
        actions={<>{isDistrict && <LinkButton href="/app/programs">My programs</LinkButton>}{user.isStaff && <LinkButton href="/app/reviews">Reviews</LinkButton>}{user.isStateAdmin && <LinkButton href="/app/admin/cycles">Cycles</LinkButton>}</>} />
      {params.denied && <div className="mb-4"><Alert tone="warning">That page is not available for your role.</Alert></div>}
      {user.roles.size === 0 && <Alert tone="warning">Your account has no active role. Contact the TAPE coordinator.</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><p className="text-3xl font-semibold tabular-nums">{rows.length}</p><p className="text-sm text-ink-muted">program reviews {isDistrict ? "in your system" : "in scope"} this year</p><p className="mt-2 text-xs text-ink-muted">{[...byStatus.entries()].map(([s, n]) => `${n} ${statusLabel(s).toLowerCase()}`).join(", ") || "none yet"}</p></Card>
        <Card><p className="text-3xl font-semibold tabular-nums">{scored.length}</p><p className="text-sm text-ink-muted">finalized</p><p className="mt-2 text-xs text-ink-muted">{scored.length ? `${level2} indicators at Level 2, ${level1} at Level 1` : "no scores locked yet"}</p></Card>
        <Card><p className="text-3xl font-semibold tabular-nums">{openFindings}</p><p className="text-sm text-ink-muted">open findings</p><p className="mt-2 text-xs text-ink-muted">{rows.reduce((n, r) => n + Number(r.cleared_findings), 0)} cleared</p></Card>
        <Card><p className="text-3xl font-semibold tabular-nums">{openPips.length}</p><p className="text-sm text-ink-muted">open improvement plans</p><p className="mt-2 text-xs text-ink-muted">{overduePips.length ? <span className="text-danger">{overduePips.length} past due</span> : "none past due"}{user.isStaff && drafts && drafts.length > 0 ? `, ${drafts.filter((d) => d.status === "draft").length} drafts waiting, ${drafts.filter((d) => d.status === "approved").length} approved to send` : ""}</p></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Coming up" actions={<Link href="/app/calendar" className="text-sm font-semibold text-brand underline">Calendar</Link>}>
          {(upcoming ?? []).length === 0 ? <Empty>No upcoming milestones.</Empty> : (
            <ul className="divide-y divide-line text-sm">{(upcoming ?? []).map((m) => <li key={m.id} className="flex flex-wrap items-center gap-3 py-2"><span className="w-28 tabular-nums">{fmtDate(m.on_date)}</span><Badge tone={m.done ? "good" : "neutral"}>{statusLabel(m.kind)}</Badge>{user.isStaff ? <Link href={`/app/admin/reviews/${m.lea_review_id}`} className="font-semibold text-brand underline">{m.lea_name}</Link> : <span className="font-semibold">{m.lea_name}</span>}</li>)}</ul>
          )}
        </Card>
        {leadershipOnly || user.isStateAdmin || user.roles.has("cluster_admin") ? (
          <Card title="Findings by indicator" actions={<a href="/app/export/findings.xlsx" className="text-sm font-semibold text-brand underline">Export</a>}>
            {(findings.data ?? []).length === 0 ? <Empty>No findings recorded this year.</Empty> : (
              <Table caption="Findings by indicator" head={<tr><th className={th}>QPI</th><th className={th}>Open</th><th className={th}>Cleared</th></tr>}>
                {(findings.data ?? []).map((f) => <tr key={f.qpi_code}><td className={`${td} font-mono text-xs`}>{f.qpi_code}</td><td className={`${td} tabular-nums`}>{Number(f.open_count)}</td><td className={`${td} tabular-nums`}>{Number(f.cleared_count)}</td></tr>)}
              </Table>
            )}
          </Card>
        ) : isDistrict ? (
          <Card title="Evidence" actions={<Link href="/app/programs" className="text-sm font-semibold text-brand underline">Programs</Link>}>
            <p className="text-3xl font-semibold tabular-nums">{(files ?? []).filter((f) => f.scan_status === "clean").length}</p>
            <p className="text-sm text-ink-muted">files uploaded and clean this year{(files ?? []).some((f) => f.scan_status === "pending") ? `, ${(files ?? []).filter((f) => f.scan_status === "pending").length} still scanning` : ""}</p>
          </Card>
        ) : (
          <Card title="Your assignments" actions={<Link href="/app/reviews" className="text-sm font-semibold text-brand underline">Reviews</Link>}>
            {rows.length === 0 ? <Empty>Nothing assigned yet.</Empty> : <ul className="divide-y divide-line text-sm">{rows.slice(0, 8).map((r, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{r.lea_name}: <span className="font-mono text-xs">{r.program_code}</span> {r.program_name}</span><span className="text-ink-muted">{monthName(r.review_month)} {r.review_year} <Badge>{statusLabel(r.status)}</Badge></span></li>)}</ul>}
          </Card>
        )}
      </div>

      <Card title="Reviews this year" className="mt-6" actions={<a href="/app/export/reviews.xlsx" className="text-sm font-semibold text-brand underline">Export</a>}>
        {rows.length === 0 ? <Empty>No program reviews in scope.</Empty> : (
          <Table caption="Reviews this year" head={<tr><th className={th}>System</th><th className={th}>Program</th><th className={th}>Month</th><th className={th}>Status</th><th className={th}>Level 2</th><th className={th}>Level 1</th><th className={th}>Open findings</th><th className={th}>PIP</th></tr>}>
            {rows.slice(0, 60).map((r, i) => (
              <tr key={i}>
                <td className={td}>{r.lea_name}</td>
                <td className={td}><span className="font-mono text-xs">{r.program_code}</span> {r.program_name}</td>
                <td className={td}>{monthName(r.review_month)} {r.review_year}</td>
                <td className={td}><Badge tone={r.finalized ? "good" : r.released ? "neutral" : "warn"}>{statusLabel(r.status)}</Badge></td>
                <td className={`${td} tabular-nums`}>{r.finalized ? Number(r.level2) : ""}</td>
                <td className={`${td} tabular-nums`}>{r.finalized ? Number(r.level1) : ""}</td>
                <td className={`${td} tabular-nums`}>{Number(r.open_findings) || ""}</td>
                <td className={td}>{r.pip_status ? <Badge tone={r.pip_status === "open" ? "warn" : "good"}>{r.pip_status}{r.pip_due ? `, due ${fmtDate(r.pip_due)}` : ""}</Badge> : ""}</td>
              </tr>
            ))}
          </Table>
        )}
        {rows.length > 60 && <p className="mt-2 text-xs text-ink-muted">Showing 60 of {rows.length}. The export has every row.</p>}
      </Card>
      <p className="mt-6 flex flex-wrap gap-3 text-sm">
        <span className="text-ink-muted">Exports:</span>
        {(["reviews", "programs", "findings", "pips", "calendar", ...(user.isStaff ? ["drafts", "evidence"] : []), ...(user.isStateAdmin ? ["audit"] : [])] as string[]).map((k) => <a key={k} href={`/app/export/${k}.xlsx`} className="text-brand underline">{statusLabel(k)}</a>)}
      </p>
    </>
  );
}
