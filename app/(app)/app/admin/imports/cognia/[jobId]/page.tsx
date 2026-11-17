import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { applyCogniaImport, discardImport } from "@/lib/actions/imports";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDate, fmtDateTime, monthName } from "@/lib/format";
import type { CogniaPlan } from "@/lib/import/cognia-list";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Import preview" };

export default async function CogniaPreviewPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: SearchParams }) {
  await requireRole("state_admin");
  const { jobId } = await params;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: job }, { data: leas }, { data: catalog }] = await Promise.all([
    supabase.from("import_jobs").select("*").eq("id", jobId).eq("kind", "cognia_list").maybeSingle(),
    supabase.from("leas").select("name"),
    supabase.from("program_catalog").select("name"),
  ]);
  if (!job) notFound();
  const plan = job.plan as CogniaPlan;
  const result = job.result as { leasCreated: number; reviews: number; programs: number; assignments: number; contacts: number; skipped: string[] } | null;
  const known = new Set((leas ?? []).map((l) => l.name.trim().toLowerCase()));
  const programs = new Set((catalog ?? []).map((p) => p.name.trim().toLowerCase()));
  const totalPrograms = plan.leas.reduce((n, l) => n + l.programs.length, 0);
  const unknownPrograms = plan.leas.flatMap((l) => l.programs.filter((p) => !programs.has(p.program.trim().toLowerCase())).map((p) => `${l.lea}: ${p.program}`));

  return (
    <>
      <PageHeader eyebrow="Imports" title={`Preview: ${job.file_name}`} description={`${plan.leas.length} systems and ${totalPrograms} programs from sheet "${plan.sheet}" (${plan.rowCount} rows), read ${fmtDateTime(job.created_at)}.`} actions={<LinkButton href="/app/admin/imports/cognia">Back</LinkButton>} />
      <Notices {...notices} />
      {job.status === "applied" && result && <div className="mb-4"><Alert tone="success" title="Applied">{result.reviews} system reviews, {result.programs} program reviews, {result.assignments} reviewer assignments, {result.contacts} Director contacts, {result.leasCreated} new systems. {result.skipped.length} items skipped.{result.skipped.length > 0 && <ul className="mt-2 list-disc pl-5">{result.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>}</Alert></div>}
      {job.status === "discarded" && <div className="mb-4"><Alert tone="info">This preview was discarded.</Alert></div>}
      {plan.problems.length > 0 && <div className="mb-4"><Alert tone="warning" title={`${plan.problems.length} rows need attention`}><ul className="list-disc pl-5">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Alert></div>}
      {unknownPrograms.length > 0 && <div className="mb-4"><Alert tone="danger" title="Programs not in the catalog (these rows will be skipped)">Add them under Programs first, or check the spelling. <ul className="list-disc pl-5">{unknownPrograms.map((p, i) => <li key={i}>{p}</li>)}</ul></Alert></div>}
      <Card title="What will happen">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>Each system is added to the cycle&apos;s compliance list with its review month and marked released as of its Cognia publish date, since those districts were already notified.</li>
          <li>Systems not on file are created with a placeholder three-digit code starting at 700. Correct the real ALSDE code on the LEA page.</li>
          <li>Each program becomes a program review with its reviewers (first listed is lead) and cluster administrator assigned by email. People are linked to accounts when they first sign in. No invitations are sent.</li>
          <li>The CTE Director is stored as a contact for the system. Director accounts are invited separately, by you, when you are ready.</li>
        </ul>
      </Card>
      <div className="mt-4">
        <Table caption="Systems in this file" head={<tr><th className={th}>System</th><th className={th}>Publish</th><th className={th}>Review month</th><th className={th}>Director</th><th className={th}>Programs</th></tr>}>
          {plan.leas.map((l) => (
            <tr key={l.lea}>
              <td className={td}>{l.lea} {known.has(l.lea.trim().toLowerCase()) ? <Badge tone="good">On file</Badge> : <Badge tone="warn">New</Badge>}</td>
              <td className={td}>{fmtDate(l.publishDate)}</td>
              <td className={td}>{monthName(l.reviewMonth)} {l.reviewYear}</td>
              <td className={td}>{l.director ? `${l.director.name} (${l.director.email})` : <span className="text-ink-muted">None</span>}</td>
              <td className={td}>
                <ul className="space-y-1">{l.programs.map((p, i) => <li key={i}>{p.program} <span className="text-ink-muted">({p.cluster})</span>{!programs.has(p.program.trim().toLowerCase()) && <> <Badge tone="bad">Not in catalog</Badge></>}<span className="block text-xs text-ink-muted">{p.reviewers.map((r) => r.name || r.email).join(", ")}{p.admin ? `; admin ${p.admin.name || p.admin.email}` : ""}</span></li>)}</ul>
              </td>
            </tr>
          ))}
        </Table>
      </div>
      {job.status === "previewed" && plan.leas.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action={applyCogniaImport}><input type="hidden" name="job_id" value={job.id} /><Button type="submit">Apply the import</Button></form>
          <form action={discardImport}><input type="hidden" name="job_id" value={job.id} /><input type="hidden" name="return_to" value="/app/admin/imports/cognia" /><Button type="submit" variant="secondary">Discard</Button></form>
        </div>
      )}
    </>
  );
}
