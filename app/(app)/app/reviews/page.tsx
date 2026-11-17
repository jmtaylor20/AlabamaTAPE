import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDate, fmtRange, monthName, statusLabel } from "@/lib/format";

type Count = { lea_id: string; lea_name: string; program_code: string; program_name: string; review_month: number; review_year: number; status: string; released: boolean; finalized: boolean; level2: number; level1: number; open_findings: number; pip_status: string | null; pip_due: string | null };
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Card, Code, Empty, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Reviews" };

/** Staff view: the reviews assigned to me, then every system on the cycle so reviewers can nominate and offer dates. */
export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const notices = await readNotices(searchParams);
  if (!user.isStaff) return <Alert tone="warning">This page is for ALSDE staff.</Alert>;
  const supabase = await createUserClient();
  const [{ data: mine }, { data: reviews }] = await Promise.all([
    supabase.from("review_assignments").select("id, assignment_role, program_reviews(id, program_code, status, visit_date, finalized_at, program_catalog(name), lea_reviews(id, review_month, review_year, visit_start, visit_end, released_at, leas(name)), program_review_sites(id, school_id))").is("revoked_at", null).or(`user_id.eq.${user.id},email.eq.${user.email}`),
    supabase.from("lea_reviews").select("id, lea_id, review_month, review_year, status, visit_start, visit_end, choice1_start, choice2_start, released_at, leas(name, system_code), review_cycles(name), milestones(kind, computed_on, override_on), program_reviews(status)").order("review_year").order("review_month"),
  ]);
  type Row = { id: string; assignment_role: string; program_reviews: { id: string; program_code: string; status: string; visit_date: string | null; finalized_at: string | null; program_catalog: { name: string } | null; lea_reviews: { id: string; review_month: number; review_year: number; visit_start: string | null; visit_end: string | null; released_at: string | null; leas: { name: string } | null } | null; program_review_sites: { id: string; school_id: string | null }[] } | null };
  const assigned = ((mine ?? []) as unknown as Row[]).filter((r) => r.program_reviews && r.program_reviews.status !== "removed");
  const { data: year } = await supabase.from("school_years").select("id").eq("is_current", true).maybeSingle();
  const results = ((await supabase.rpc("review_counts", { p_school_year: year?.id ?? null })).data ?? []) as Count[];
  const { data: declared } = year ? await supabase.from("declared_programs").select("id, lea_id, program_code, home_school_id").eq("school_year_id", year.id).eq("status", "active") : { data: [] };
  const leaOf = new Map<string, string>();
  for (const r of reviews ?? []) leaOf.set(r.id, (r as unknown as { lea_id?: string }).lea_id ?? "");

  return (
    <>
      <PageHeader eyebrow="ALSDE staff" title="Reviews" description="Programs assigned to you, and every system on the compliance list. Before release you can nominate programs and offer visit dates." />
      <Notices {...notices} />
      <Card title="Assigned to me">
        {assigned.length === 0 ? <Empty>No programs are assigned to you yet.</Empty> : (
          <Table caption="My assignments" head={<tr><th className={th}>System</th><th className={th}>Program</th><th className={th}>Role</th><th className={th}>Review month</th><th className={th}>Visit</th><th className={th}>Status</th><th className={th}>Workspace</th></tr>}>
            {assigned.map((r) => {
              const p = r.program_reviews!;
              const lr = p.lea_reviews;
              const site = p.program_review_sites[0];
              const dp = lr ? (declared ?? []).find((d) => d.lea_id === leaOf.get(lr.id) && d.program_code === p.program_code && (d.home_school_id ?? null) === (site?.school_id ?? null)) : undefined;
              return (
                <tr key={r.id}>
                  <td className={td}>{lr ? <Link href={`/app/admin/reviews/${lr.id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">{lr.leas?.name}</Link> : ""}</td>
                  <td className={td}><span className="font-mono text-xs">{p.program_code}</span> {p.program_catalog?.name}</td>
                  <td className={td}><Badge>{statusLabel(r.assignment_role)}</Badge></td>
                  <td className={td}>{lr ? `${monthName(lr.review_month)} ${lr.review_year}` : ""}</td>
                  <td className={td}>{p.visit_date ? fmtDate(p.visit_date) : fmtRange(lr?.visit_start, lr?.visit_end)}</td>
                  <td className={td}><Badge tone={p.finalized_at ? "good" : lr?.released_at ? "neutral" : "warn"}>{lr?.released_at ? statusLabel(p.status) : "Not released"}</Badge></td>
                  <td className={td}>{dp && lr?.released_at ? <Link href={`/app/programs/${dp.id}/review`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">Open review</Link> : ""}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card title="All systems on the list" className="mt-6">
        {(reviews ?? []).length === 0 ? <Empty>No cycle is set up yet.</Empty> : (
          <Table caption="Systems under review" head={<tr><th className={th}>Review month</th><th className={th}>System</th><th className={th}>Programs</th><th className={th}>Notification</th><th className={th}>Dates</th><th className={th}>Status</th></tr>}>
            {(reviews ?? []).map((r) => {
              const lea = r.leas as unknown as { name: string; system_code: string } | null;
              const ms = (r.milestones as unknown as { kind: string; computed_on: string | null; override_on: string | null }[]) ?? [];
              const notif = ms.find((m) => m.kind === "notification");
              const count = ((r.program_reviews as unknown as { status: string }[]) ?? []).filter((p) => p.status !== "removed").length;
              return (
                <tr key={r.id}>
                  <td className={td}>{monthName(r.review_month)} {r.review_year}</td>
                  <td className={td}><Link href={`/app/admin/reviews/${r.id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">{lea?.name}</Link></td>
                  <td className={`${td} tabular-nums`}>{count}</td>
                  <td className={td}>{fmtDate(notif?.override_on ?? notif?.computed_on)}</td>
                  <td className={td}>{r.visit_start ? fmtRange(r.visit_start, r.visit_end) : r.choice1_start ? `Choices offered` : "Open"}</td>
                  <td className={td}>{r.released_at ? <Badge tone="good">Released</Badge> : <Badge>{statusLabel(r.status)}</Badge>}</td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
      <Card title="Results this year" className="mt-6" description="Scores and findings appear once a review is finalized." actions={<><a href="/app/export/reviews.xlsx" className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">Export reviews</a><a href="/app/export/findings.xlsx" className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">Export findings</a></>}>
        {results.length === 0 ? <Empty>No program reviews in scope.</Empty> : (
          <Table caption="Results this year" head={<tr><th className={th}>System</th><th className={th}>Program</th><th className={th}>Status</th><th className={th}>Level 1</th><th className={th}>Open findings</th><th className={th}>Improvement plan</th></tr>}>
            {results.map((r, i) => (
              <tr key={i}>
                <td className={td}>{r.lea_name}<span className="block text-xs text-ink-muted">{monthName(r.review_month)} {r.review_year}</span></td>
                <td className={td}>{r.program_name} <Code>{r.program_code}</Code></td>
                <td className={td}><Badge tone={r.finalized ? "good" : r.released ? "neutral" : "warn"}>{r.released ? statusLabel(r.status) : "Not released"}</Badge></td>
                <td className={`${td} tabular-nums`}>{r.finalized ? Number(r.level1) : ""}</td>
                <td className={`${td} tabular-nums`}>{Number(r.open_findings) || ""}</td>
                <td className={td}>{r.pip_status ? <Badge tone={r.pip_status === "open" ? "warn" : "good"}>{statusLabel(r.pip_status)}{r.pip_due ? `, due ${fmtDate(r.pip_due)}` : ""}</Badge> : ""}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
