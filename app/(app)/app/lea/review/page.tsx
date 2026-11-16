import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, fmtRange, monthName, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Alert, Badge, Card, Empty, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "My TAPE review" };

/**
 * The district view of its review. Before release the database returns only
 * the summary: on the list, the month, and the notification date. Programs,
 * reviewers, and dates appear only after the State Admin releases.
 */
export default async function LeaReviewPage() {
  const user = await requireUser();
  const leaId = user.leaIds[0];
  if (!leaId) return <Alert tone="warning">Your account is not attached to a system.</Alert>;
  const supabase = await createUserClient();
  const { data: summaries } = await supabase.rpc("my_lea_review_summary");
  const rows = (summaries ?? []) as { lea_review_id: string; review_month: number; review_year: number; notification_on: string | null; released: boolean; status: string }[];
  const releasedIds = rows.filter((r) => r.released).map((r) => r.lea_review_id);
  const { data: declared } = await supabase.from("declared_programs").select("id, program_code, home_school_id, school_years!inner(is_current)").eq("lea_id", leaId).eq("school_years.is_current", true).eq("status", "active");
  const programLink = (code: string, schoolId: string | null) => (declared ?? []).find((d) => d.program_code === code && (d.home_school_id ?? null) === (schoolId ?? null))?.id;
  const { data: released } = releasedIds.length
    ? await supabase.from("lea_reviews").select("id, review_month, review_year, visit_start, visit_end, status, milestones(kind, computed_on, override_on), program_reviews(id, program_code, status, visit_date, sequence, program_catalog(name), review_assignments(display_name, email, assignment_role, revoked_at), program_review_sites(id, school_id, director_submitted_at))").in("id", releasedIds)
    : { data: [] };

  return (
    <>
      <PageHeader eyebrow="My system" title="TAPE review" description="Where your system stands in the review cycle." />
      {rows.length === 0 ? <Empty>Your system is not on the current compliance list.</Empty> : rows.map((r) => {
        const full = (released ?? []).find((x) => x.id === r.lea_review_id);
        if (!full) {
          return (
            <Card key={r.lea_review_id} title={`${monthName(r.review_month)} ${r.review_year} review`}>
              <p className="text-sm">Your system is scheduled for a TAPE review in {monthName(r.review_month)} {r.review_year}. {r.notification_on ? `Details, including the programs selected, the reviewers, and the dates, are released on ${fmtDate(r.notification_on)}.` : "Details are released on the notification date."}</p>
              <p className="mt-2 text-sm text-ink-muted">Until then, keep every program&apos;s evidence current and make sure your declared programs are correct.</p>
            </Card>
          );
        }
        const ms = (full.milestones as unknown as { kind: string; computed_on: string | null; override_on: string | null }[]) ?? [];
        const date = (kind: string) => { const m = ms.find((x) => x.kind === kind); return fmtDate(m?.override_on ?? m?.computed_on); };
        type PR = { id: string; program_code: string; status: string; visit_date: string | null; sequence: number | null; program_catalog: { name: string } | null; review_assignments: { display_name: string | null; email: string; assignment_role: string; revoked_at: string | null }[]; program_review_sites: { id: string; school_id: string | null; director_submitted_at: string | null }[] };
        const programs = ((full.program_reviews as unknown as PR[]) ?? []).filter((p) => p.status !== "removed").sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));
        return (
          <Card key={r.lea_review_id} title={`${monthName(r.review_month)} ${r.review_year} review`} actions={<Badge tone="good">{statusLabel(full.status)}</Badge>}>
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="font-semibold">Visit</dt><dd>{fmtRange(full.visit_start, full.visit_end)}</dd></div>
              <div><dt className="font-semibold">Evidence due</dt><dd>{date("evidence_due") || "Not set"}</dd></div>
              <div><dt className="font-semibold">Ten-day follow-up closes</dt><dd>{date("ten_day_close") || "Not set"}</dd></div>
            </dl>
            <h3 className="mt-4 text-sm font-semibold">Programs under review</h3>
            {programs.length === 0 ? <Empty>No programs listed.</Empty> : (
              <Table caption="Programs under review" head={<tr><th className={th}>Program</th><th className={th}>Reviewers</th><th className={th}>Visit date</th><th className={th}>Status</th><th className={th}>Evidence</th></tr>}>
                {programs.map((p) => {
                  const site = p.program_review_sites[0];
                  const dpId = programLink(p.program_code, site?.school_id ?? null);
                  return (
                  <tr key={p.id}>
                    <td className={td}>{dpId ? <Link href={`/app/programs/${dpId}`} className="font-semibold text-brand underline"><span className="font-mono text-xs">{p.program_code}</span> {p.program_catalog?.name}</Link> : <><span className="font-mono text-xs">{p.program_code}</span> {p.program_catalog?.name}</>}</td>
                    <td className={td}>{p.review_assignments.filter((a) => !a.revoked_at && a.assignment_role !== "cluster_admin").map((a) => a.display_name ?? a.email).join(", ") || "To be assigned"}</td>
                    <td className={td}>{p.visit_date ? fmtDate(p.visit_date) : fmtRange(full.visit_start, full.visit_end)}</td>
                    <td className={td}><Badge>{statusLabel(p.status)}</Badge></td>
                    <td className={td}>{site?.director_submitted_at ? <Badge tone="good">Submitted</Badge> : dpId ? <Link href={`/app/programs/${dpId}`} className="text-brand underline">Upload and self-score</Link> : ""}</td>
                  </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        );
      })}
    </>
  );
}
