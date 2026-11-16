import type { Metadata } from "next";
import Link from "next/link";
import { runEscalations } from "@/lib/actions/pips";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDate, statusLabel, todayIso } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Empty, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Improvement plans" };

/** Every PIP the caller may see, with the clock, open goals, and escalations. */
export default async function PipsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: pips } = await supabase.from("pips").select("id, status, starts_on, due_on, closed_at, program_reviews(id, program_code, program_catalog(name), lea_reviews(lea_id, leas(name), review_cycles(school_year_id)), program_review_sites(school_id, schools(name))), pip_goals(status), pip_escalations(month)").order("due_on");
  type Row = { id: string; status: string; starts_on: string; due_on: string; closed_at: string | null; program_reviews: { id: string; program_code: string; program_catalog: { name: string } | null; lea_reviews: { lea_id: string; leas: { name: string } | null; review_cycles: { school_year_id: string } | null } | null; program_review_sites: { school_id: string | null; schools: { name: string } | null }[] } | null; pip_goals: { status: string | null }[]; pip_escalations: { month: number }[] };
  const rows = (pips ?? []) as unknown as Row[];
  const { data: declared } = await supabase.from("declared_programs").select("id, lea_id, school_year_id, program_code, home_school_id").eq("status", "active");
  const link = (r: Row) => { const pr = r.program_reviews; const site = pr?.program_review_sites[0]; const dp = (declared ?? []).find((d) => d.lea_id === pr?.lea_reviews?.lea_id && d.school_year_id === pr?.lea_reviews?.review_cycles?.school_year_id && d.program_code === pr?.program_code && (d.home_school_id ?? null) === (site?.school_id ?? null)); return dp ? `/app/programs/${dp.id}/pip` : null; };
  const today = todayIso();

  return (
    <>
      <PageHeader eyebrow="Follow-up" title="Program Improvement Plans" description="Open plans run twelve months from the day after the ten-day close. Escalations at months 6, 9, and 11 inform the cluster administrator and the TAPE liaison when goals remain open."
        actions={user.isStateAdmin ? <form action={runEscalations}><input type="hidden" name="return_to" value="/app/pips" /><Button type="submit" variant="secondary">Run escalation check</Button></form> : undefined} />
      <Notices {...notices} />
      {rows.length === 0 ? <Empty>No improvement plans to show.</Empty> : (
        <Table caption="Program Improvement Plans" head={<tr><th className={th}>System</th><th className={th}>Program</th><th className={th}>Started</th><th className={th}>Due</th><th className={th}>Goals</th><th className={th}>Escalations</th><th className={th}>Status</th></tr>}>
          {rows.map((r) => {
            const pr = r.program_reviews;
            const href = link(r);
            const open = r.pip_goals.filter((g) => !g.status || g.status === "not_complete").length;
            const overdue = r.status === "open" && r.due_on < today;
            return (
              <tr key={r.id}>
                <td className={td}>{pr?.lea_reviews?.leas?.name}</td>
                <td className={td}>{href ? <Link href={href} className="font-semibold text-brand underline"><span className="font-mono text-xs">{pr?.program_code}</span> {pr?.program_catalog?.name}</Link> : <><span className="font-mono text-xs">{pr?.program_code}</span> {pr?.program_catalog?.name}</>}<span className="block text-xs text-ink-muted">{pr?.program_review_sites[0]?.schools?.name ?? ""}</span></td>
                <td className={td}>{fmtDate(r.starts_on)}</td>
                <td className={td}>{fmtDate(r.due_on)}{overdue && <> <Badge tone="bad">Past due</Badge></>}</td>
                <td className={`${td} tabular-nums`}>{user.roles.has("leadership") && !user.isStateAdmin ? "" : `${open} open of ${r.pip_goals.length}`}</td>
                <td className={td}>{r.pip_escalations.length ? r.pip_escalations.map((e) => <Badge key={e.month} tone="warn">Month {e.month}</Badge>) : ""}</td>
                <td className={td}><Badge tone={r.status === "open" ? "warn" : "good"}>{statusLabel(r.status)}</Badge>{r.closed_at && <span className="block text-xs text-ink-muted">{fmtDate(r.closed_at)}</span>}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
