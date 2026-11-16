import type { Metadata } from "next";
import Link from "next/link";
import { previewMasterImport, previewScheduleImport } from "@/lib/actions/imports";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select } from "@/lib/ui";

export const metadata: Metadata = { title: "Imports" };

export default async function ImportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: cycles }, { data: jobs }] = await Promise.all([
    supabase.from("review_cycles").select("id, name").order("created_at", { ascending: false }),
    supabase.from("import_jobs").select("id, kind, file_name, status, summary, created_at").order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <>
      <PageHeader eyebrow="Administration" title="Imports" description="Every import is parsed into a preview first. Nothing is written until you apply it, and every applied import is logged." actions={<><LinkButton href="/app/admin/imports/cognia">Cognia list</LinkButton><LinkButton href="/app/admin/declarations">Declarations</LinkButton></>} />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Master spreadsheet">
          <p className="mb-3 text-sm text-ink-muted">The Program Master, District Directory, Schools, and Schedule tabs in one workbook. Sheets are recognized by their headers. Systems created from the Cognia list with a placeholder code get their real ALSDE code here.</p>
          <form action={previewMasterImport} className="flex flex-col gap-3">
            <Field id="m_cycle" label="Cycle for the Schedule tab (optional)"><Select id="m_cycle" name="cycle_id" defaultValue=""><option value="">Do not load the schedule</option>{(cycles ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field id="m_file" label="Workbook (.xlsx)"><Input id="m_file" name="file" type="file" accept=".xlsx" required className="py-2" /></Field>
            <Button type="submit">Preview</Button>
          </form>
        </Card>
        <Card title="Visit scheduling form responses">
          <p className="mb-3 text-sm text-ink-muted">A system and two date ranges per row. Choices are recorded on the system&apos;s review; systems already released are skipped and changed on their review page with a reason.</p>
          <form action={previewScheduleImport} className="flex flex-col gap-3">
            <Field id="s_cycle" label="Cycle"><Select id="s_cycle" name="cycle_id" required>{(cycles ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field id="s_file" label="Responses (.xlsx)"><Input id="s_file" name="file" type="file" accept=".xlsx" required className="py-2" /></Field>
            <Button type="submit">Preview</Button>
          </form>
        </Card>
      </div>
      <Card title="Past imports" className="mt-6">
        {(jobs ?? []).length === 0 ? <Empty>No imports yet.</Empty> : (
          <ul className="divide-y divide-line text-sm">
            {(jobs ?? []).map((j) => {
              const href = j.kind === "cognia_list" ? `/app/admin/imports/cognia/${j.id}` : j.kind === "declarations" ? null : `/app/admin/imports/${j.id}`;
              return <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{href ? <Link href={href} className="text-brand underline">{j.file_name}</Link> : j.file_name} <Badge>{statusLabel(j.kind)}</Badge></span><span className="text-ink-muted">{fmtDateTime(j.created_at)}</span><Badge tone={j.status === "applied" ? "good" : j.status === "discarded" ? "neutral" : "warn"}>{j.status}</Badge></li>;
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
