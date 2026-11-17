import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { closeDeclarationWindow, openDeclarationWindow, saveDeclaredProgram } from "@/lib/actions/cycles";
import { previewDeclarationImport } from "@/lib/actions/imports";
import { requireRole } from "@/lib/auth/session";
import { DeclarationForm, DeclarationTable, RevisionList, type DeclaredProgramRow, type Revision } from "@/lib/components/declarations";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime, windowOpen } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader } from "@/lib/ui";

export const metadata: Metadata = { title: "Declarations" };

export default async function LeaDeclarationsAdminPage({ params, searchParams }: { params: Promise<{ leaId: string }>; searchParams: SearchParams }) {
  await requireRole("state_admin");
  const { leaId } = await params;
  const here = `/app/admin/declarations/${leaId}`;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: lea }, { data: year }] = await Promise.all([
    supabase.from("leas").select("id, system_code, name").eq("id", leaId).maybeSingle(),
    supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle(),
  ]);
  if (!lea) notFound();
  if (!year) return <Alert tone="warning">Set a current school year in Settings first.</Alert>;
  const [{ data: declared }, { data: windows }, { data: revisions }, { data: schools }, { data: catalog }, { data: teachers }, { data: leas }, { data: jobs }] = await Promise.all([
    supabase.from("declared_programs").select("*, program_catalog(name, cluster_code, active), home:schools!declared_programs_home_school_id_fkey(name, school_code), location:leas!declared_programs_location_lea_id_fkey(name), declared_program_teachers(teacher_id, teachers(display_name))").eq("lea_id", leaId).eq("school_year_id", year.id).order("program_code"),
    supabase.from("declaration_windows").select("*").eq("lea_id", leaId).eq("school_year_id", year.id).order("opens_at", { ascending: false }),
    supabase.from("declaration_revisions").select("id, action, before, after, reason, actor_id, occurred_at, window_id").eq("lea_id", leaId).eq("school_year_id", year.id).order("occurred_at", { ascending: false }).limit(200),
    supabase.from("schools").select("id, school_code, name").eq("lea_id", leaId).order("school_code"),
    supabase.from("program_catalog").select("code, name, cluster_code").eq("active", true).order("code"),
    supabase.from("teachers").select("id, display_name").eq("lea_id", leaId).eq("status", "active").order("display_name"),
    supabase.from("leas").select("id, system_code, name").eq("active", true).order("name"),
    supabase.from("import_jobs").select("id, file_name, status, summary, created_at").eq("lea_id", leaId).eq("kind", "declarations").order("created_at", { ascending: false }).limit(10),
  ]);
  const current = (windows ?? [])[0];
  const open = windowOpen(current);

  return (
    <>
      <PageHeader eyebrow={`Declarations ${year.label}`} title={lea.name} description="Import the system's declared programs, open the review window when you are ready, and watch what the Director changes." actions={<LinkButton href="/app/admin/declarations">All systems</LinkButton>} />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Review window">
          {current ? (
            <p className="text-sm">Latest window opened {fmtDateTime(current.opens_at)}, closes {fmtDateTime(current.closes_at)}. {current.confirmed_at ? <Badge tone="good">Confirmed {fmtDateTime(current.confirmed_at)}</Badge> : current.closed_early_at ? <Badge>Closed early {fmtDateTime(current.closed_early_at)}</Badge> : open ? <Badge tone="warn">Open</Badge> : <Badge>Expired</Badge>}{current.note && <span className="block text-ink-muted">{current.note}</span>}</p>
          ) : <p className="text-sm text-ink-muted">No window has been opened for this year. The Director can see the list but cannot change it.</p>}
          {open ? (
            <form action={closeDeclarationWindow} className="mt-3"><input type="hidden" name="id" value={current.id} /><input type="hidden" name="lea_id" value={leaId} /><Button type="submit" variant="danger">Close the window now</Button></form>
          ) : (
            <form action={openDeclarationWindow} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="lea_id" value={leaId} /><input type="hidden" name="school_year_id" value={year.id} />
              <Field id="closes" label="Closes on" hint="The Director may change the list until the end of this day or until they confirm."><Input id="closes" name="closes_at" type="date" required /></Field>
              <Field id="note" label="Note to the Director (optional)"><Input id="note" name="note" /></Field>
              <div className="sm:col-span-2"><Button type="submit">Open the review window</Button></div>
            </form>
          )}
        </Card>
        <Card title="Import a spreadsheet">
          <form action={previewDeclarationImport} className="flex flex-col gap-3">
            <input type="hidden" name="lea_id" value={leaId} /><input type="hidden" name="school_year_id" value={year.id} />
            <Field id="file" label="PowerSchool export (.xlsx)" hint="Columns are matched by name: system, school, program code, type, dual scenario, teacher. You will see a preview before anything is saved."><Input id="file" name="file" type="file" accept=".xlsx" required className="py-2" /></Field>
            <Button type="submit" variant="secondary">Preview the import</Button>
          </form>
          {(jobs ?? []).length > 0 && (
            <ul className="mt-3 divide-y divide-line text-sm">{(jobs ?? []).map((j) => <li key={j.id} className="flex items-center justify-between gap-2 py-2"><Link href={`${here}/import/${j.id}`} className="text-brand underline decoration-brand/40 underline-offset-2">{j.file_name}</Link><span className="text-ink-muted">{fmtDateTime(j.created_at)}</span><Badge tone={j.status === "applied" ? "good" : j.status === "discarded" ? "neutral" : "warn"}>{j.status}</Badge></li>)}</ul>
          )}
        </Card>
      </div>

      <Card title={`Declared programs (${(declared ?? []).filter((d) => d.status === "active").length})`} className="mt-6">
        <DeclarationTable rows={(declared ?? []) as unknown as DeclaredProgramRow[]} editable returnTo={here} leaId={leaId} schoolYearId={year.id} schools={schools ?? []} catalog={catalog ?? []} teachers={teachers ?? []} leas={leas ?? []} action={saveDeclaredProgram} />
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold text-brand">Add a program by hand</summary>
          <DeclarationForm returnTo={here} leaId={leaId} schoolYearId={year.id} schools={schools ?? []} catalog={catalog ?? []} teachers={teachers ?? []} leas={leas ?? []} action={saveDeclaredProgram} />
        </details>
      </Card>

      <Card title="Change history" className="mt-6">
        {(revisions ?? []).length === 0 ? <Empty>No changes recorded yet.</Empty> : <RevisionList revisions={(revisions ?? []) as unknown as Revision[]} windowIds={new Set((windows ?? []).map((w) => w.id))} />}
      </Card>
    </>
  );
}
