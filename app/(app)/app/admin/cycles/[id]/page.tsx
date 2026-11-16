import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addToComplianceList } from "@/lib/actions/cycles";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { MONTHS, fmtDate, fmtRange, monthName, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Cycle" };

export default async function CyclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requireRole("state_admin");
  const { id } = await params;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: cycle } = await supabase.from("review_cycles").select("id, name, target_percent, school_year_id, school_years(label)").eq("id", id).maybeSingle();
  if (!cycle) notFound();
  const [{ data: reviews }, { data: leas }] = await Promise.all([
    supabase.from("lea_reviews").select("id, lea_id, status, is_carryover, review_month, review_year, visit_start, visit_end, released_at, leas(system_code, name, code_is_placeholder), program_reviews(id, status), milestones(kind, computed_on, override_on)").eq("cycle_id", id),
    supabase.from("leas").select("id, system_code, name").eq("active", true).order("name"),
  ]);
  const rows = (reviews ?? []).sort((a, b) => a.review_year - b.review_year || a.review_month - b.review_month || ((a.leas as unknown as { name: string })?.name ?? "").localeCompare((b.leas as unknown as { name: string })?.name ?? ""));
  const label = (cycle.school_years as unknown as { label: string } | null)?.label ?? "";
  const startYear = Number(label.slice(0, 4)) || new Date().getFullYear();
  const listed = new Set(rows.map((r) => r.lea_id));

  return (
    <>
      <PageHeader eyebrow={`Cycle ${label}`} title={cycle.name} description={`Systems on this year's compliance list and where each review stands. Random selection target ${Number(cycle.target_percent)} percent of eligible programs.`}
        actions={<><LinkButton href="/app/admin/cycles">All cycles</LinkButton><LinkButton href="/app/admin/imports/cognia">Import a Cognia list</LinkButton></>} />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-[3fr_1fr]">
        <div>
          {rows.length === 0 ? <Empty>No systems on this cycle yet. Add one or import the Cognia list.</Empty> : (
            <Table caption="Systems in this cycle" head={<tr><th className={th}>Review month</th><th className={th}>System</th><th className={th}>Programs</th><th className={th}>Notification</th><th className={th}>Visit</th><th className={th}>Status</th></tr>}>
              {rows.map((r) => {
                const lea = r.leas as unknown as { system_code: string; name: string; code_is_placeholder: boolean } | null;
                const programs = ((r.program_reviews as unknown as { status: string }[]) ?? []).filter((p) => p.status !== "removed").length;
                const ms = (r.milestones as unknown as { kind: string; computed_on: string | null; override_on: string | null }[]) ?? [];
                const notif = ms.find((m) => m.kind === "notification");
                return (
                  <tr key={r.id}>
                    <td className={td}>{monthName(r.review_month)} {r.review_year}{r.is_carryover && <> <Badge tone="warn">Carryover</Badge></>}</td>
                    <td className={td}><Link href={`/app/admin/reviews/${r.id}`} className="font-semibold text-brand underline">{lea?.name}</Link> <span className="font-mono text-xs text-ink-muted">{lea?.code_is_placeholder ? "code pending" : lea?.system_code}</span></td>
                    <td className={`${td} tabular-nums`}>{programs}</td>
                    <td className={td}>{fmtDate(notif?.override_on ?? notif?.computed_on)}</td>
                    <td className={td}>{fmtRange(r.visit_start, r.visit_end)}</td>
                    <td className={td}>{r.released_at ? <Badge tone="good">Released</Badge> : <Badge>{statusLabel(r.status)}</Badge>}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
        <Card title="Add a system to this cycle">
          <form action={addToComplianceList} className="flex flex-col gap-3">
            <input type="hidden" name="cycle_id" value={cycle.id} />
            <Field id="a_lea" label="System">
              <Select id="a_lea" name="lea_id" required>
                {(leas ?? []).filter((l) => !listed.has(l.id)).map((l) => <option key={l.id} value={l.id}>{l.system_code} {l.name}</option>)}
              </Select>
            </Field>
            <Field id="a_month" label="Review month">
              <Select id="a_month" name="review_month" defaultValue="10">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
            </Field>
            <Field id="a_year" label="Review year"><Input id="a_year" name="review_year" type="number" defaultValue={startYear} min={2020} max={2100} required /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_carryover" className="h-5 w-5" /> Carryover from last year (not on the compliance list)</label>
            <Button type="submit" variant="secondary">Add system</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
