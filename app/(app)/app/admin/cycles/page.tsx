import type { Metadata } from "next";
import Link from "next/link";
import { saveCycle } from "@/lib/actions/cycles";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDate } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, td, th, Disclosure } from "@/lib/ui";

export const metadata: Metadata = { title: "Review cycles" };

export default async function CyclesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: cycles }, { data: years }] = await Promise.all([
    supabase.from("review_cycles").select("id, name, target_percent, settings, school_years(label, is_current), lea_reviews(id, status, released_at)").order("created_at", { ascending: false }),
    supabase.from("school_years").select("id, label").order("label", { ascending: false }),
  ]);
  const used = new Set((cycles ?? []).map((c) => (c.school_years as unknown as { label: string } | null)?.label));

  return (
    <>
      <PageHeader eyebrow="Administration" title="Review cycles" description="One cycle per school year. A cycle holds the compliance list, each system's review, the selection draw, and the release of each notification."
        actions={<><LinkButton href="/app/admin/imports/cognia">Import a Cognia list</LinkButton><LinkButton href="/app/admin/instrument">View the instrument</LinkButton></>} />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          {(cycles ?? []).length === 0 ? <Empty>No cycles yet. Create one for the current school year.</Empty> : (
            <Table caption="Review cycles" head={<tr><th className={th}>Cycle</th><th className={th}>School year</th><th className={th}>Target</th><th className={th}>January evidence due</th><th className={th}>Systems</th><th className={th}>Released</th></tr>}>
              {(cycles ?? []).map((c) => {
                const yr = c.school_years as unknown as { label: string; is_current: boolean } | null;
                const reviews = (c.lea_reviews as unknown as { released_at: string | null }[]) ?? [];
                const settings = (c.settings ?? {}) as { january_evidence_due?: string };
                return (
                  <tr key={c.id}>
                    <td className={td}><Link href={`/app/admin/cycles/${c.id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">{c.name}</Link></td>
                    <td className={td}>{yr?.label}{yr?.is_current ? " (current)" : ""}</td>
                    <td className={`${td} tabular-nums`}>{Number(c.target_percent)}%</td>
                    <td className={td}>{settings.january_evidence_due ? fmtDate(settings.january_evidence_due) : "First of the month"}</td>
                    <td className={`${td} tabular-nums`}>{reviews.length}</td>
                    <td className={`${td} tabular-nums`}>{reviews.filter((r) => r.released_at).length}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </div>
        <Card title="Create or update a cycle">
          <Disclosure label="Create or update a cycle" className="mt-4">
            <form action={saveCycle} className="flex flex-col gap-3">
              <Field id="c_year" label="School year">
                <Select id="c_year" name="school_year_id" required>
                  {(years ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}{used.has(y.label) ? " (has a cycle)" : ""}</option>)}
                </Select>
              </Field>
              <Field id="c_name" label="Name" hint="Example: 2026-2027 TAPE reviews"><Input id="c_name" name="name" required /></Field>
              <Field id="c_target" label="Random selection target" hint="Percent of eligible programs, rounded up, at least one."><Input id="c_target" name="target_percent" type="number" min={1} max={100} defaultValue={25} required /></Field>
              <Field id="c_jan" label="January evidence due date" hint="Evidence for January reviews is due on this date instead of January 1."><Input id="c_jan" name="january_evidence_due" type="date" /></Field>
              <Button type="submit">Save cycle</Button>
            </form>
          </Disclosure>
        </Card>
      </div>
    </>
  );
}
