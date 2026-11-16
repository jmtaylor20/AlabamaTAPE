import type { Metadata } from "next";
import Link from "next/link";
import { previewCogniaImport } from "@/lib/actions/imports";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select } from "@/lib/ui";

export const metadata: Metadata = { title: "Import a Cognia list" };

export default async function CogniaImportPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: cycles }, { data: jobs }] = await Promise.all([
    supabase.from("review_cycles").select("id, name, school_years(label)").order("created_at", { ascending: false }),
    supabase.from("import_jobs").select("id, file_name, status, summary, created_at").eq("kind", "cognia_list").order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <>
      <PageHeader eyebrow="Imports" title="Import a Cognia program list" description="Bring this year's reviews in from the Cognia TAPE Programs workbook: one row per program with the system, publish month, reviewers, administrator, and CTE Director." actions={<LinkButton href="/app/admin/cycles">Cycles</LinkButton>} />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Upload">
          {(cycles ?? []).length === 0 ? <Alert tone="warning">Create a review cycle first.</Alert> : (
            <form action={previewCogniaImport} className="flex flex-col gap-3">
              <Field id="cycle" label="Cycle"><Select id="cycle" name="cycle_id" required>{(cycles ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({(c.school_years as unknown as { label: string } | null)?.label})</option>)}</Select></Field>
              <Field id="file" label="Workbook (.xlsx)" hint="You will see a preview before anything is saved. Systems not yet on file are created with a placeholder code you can correct later. Reviewer and Director emails are stored as assignments and contacts only; no invitations are sent."><Input id="file" name="file" type="file" accept=".xlsx" required className="py-2" /></Field>
              <Button type="submit">Preview the import</Button>
            </form>
          )}
        </Card>
        <Card title="Past imports">
          {(jobs ?? []).length === 0 ? <Empty>No imports yet.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {(jobs ?? []).map((j) => {
                const s = j.summary as { leas?: number; programs?: number };
                return <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><Link href={`/app/admin/imports/cognia/${j.id}`} className="text-brand underline">{j.file_name}</Link><span className="text-ink-muted">{s.leas ?? 0} systems, {s.programs ?? 0} programs, {fmtDateTime(j.created_at)}</span><Badge tone={j.status === "applied" ? "good" : j.status === "discarded" ? "neutral" : "warn"}>{j.status}</Badge></li>;
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
