import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { applyDeclarationImport, discardImport } from "@/lib/actions/imports";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime } from "@/lib/format";
import type { DeclarationPlan } from "@/lib/import/declarations";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Import preview" };

export default async function DeclarationImportPage({ params, searchParams }: { params: Promise<{ leaId: string; jobId: string }>; searchParams: SearchParams }) {
  await requireRole("state_admin");
  const { leaId, jobId } = await params;
  const back = `/app/admin/declarations/${leaId}`;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: job } = await supabase.from("import_jobs").select("*, leas(name)").eq("id", jobId).eq("lea_id", leaId).maybeSingle();
  if (!job) notFound();
  const plan = job.plan as DeclarationPlan;
  const result = job.result as { imported: number; teachersCreated: number; skipped: string[] } | null;
  const bad = plan.rows.filter((r) => r.problems.length);

  return (
    <>
      <PageHeader eyebrow={(job.leas as unknown as { name: string } | null)?.name ?? ""} title={`Import preview: ${job.file_name}`} description={`Sheet "${plan.sheet}", ${plan.rows.length} rows read ${fmtDateTime(job.created_at)}. Nothing is saved until you apply.`} actions={<LinkButton href={back}>Back to declarations</LinkButton>} />
      <Notices {...notices} />
      {job.status === "applied" && result && <div className="mb-4"><Alert tone="success" title="Applied">{result.imported} programs imported, {result.teachersCreated} teacher records created, {result.skipped.length} rows skipped.{result.skipped.length > 0 && <ul className="mt-2 list-disc pl-5">{result.skipped.map((s, i) => <li key={i}>{s}</li>)}</ul>}</Alert></div>}
      {job.status === "discarded" && <div className="mb-4"><Alert tone="info">This preview was discarded.</Alert></div>}
      {plan.problems.length > 0 && <div className="mb-4"><Alert tone="danger" title="The file cannot be imported as is"><ul className="list-disc pl-5">{plan.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Alert></div>}
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Card title="Columns matched"><ul className="text-sm">{Object.entries(plan.columns).map(([k, v]) => <li key={k}>{k}: {v ? <code className="rounded bg-brand-soft px-1">{v}</code> : <Badge tone="warn">not found</Badge>}</li>)}</ul></Card>
        <Card title="Columns ignored"><p className="text-sm">{plan.unmatchedHeaders.join(", ") || "None"}</p></Card>
        <Card title="Rows with problems"><p className="text-3xl font-semibold tabular-nums">{bad.length}</p><p className="text-sm text-ink-muted">These rows are skipped.</p></Card>
      </div>
      <Table caption="Rows to import" head={<tr><th className={th}>Row</th><th className={th}>School</th><th className={th}>Program</th><th className={th}>Type</th><th className={th}>Teacher</th><th className={th}>Problems</th></tr>}>
        {plan.rows.map((r) => (
          <tr key={r.row} className={r.problems.length ? "bg-danger-soft/40" : ""}>
            <td className={`${td} tabular-nums`}>{r.row}</td>
            <td className={td}>{r.schoolCode} {r.schoolName}{r.locationSystemCode && <span className="block text-xs text-ink-muted">at {r.locationSystemCode} {r.locationSchoolCode}</span>}</td>
            <td className={td}><span className="font-mono text-xs">{r.programCode}</span> {r.programName}</td>
            <td className={td}>{r.deliveryType}{r.dualScenario ? ` ${r.dualScenario}` : ""}</td>
            <td className={td}>{r.teacherName}{r.teacherEmail && <span className="block text-xs text-ink-muted">{r.teacherEmail}</span>}</td>
            <td className={td}>{r.problems.join("; ")}</td>
          </tr>
        ))}
      </Table>
      {job.status === "previewed" && plan.problems.length === 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <form action={applyDeclarationImport} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="job_id" value={job.id} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="replace" className="h-5 w-5" /> Mark programs not in this file as removed</label>
            <Button type="submit">Apply the import</Button>
          </form>
          <form action={discardImport}><input type="hidden" name="job_id" value={job.id} /><input type="hidden" name="return_to" value={back} /><Button type="submit" variant="secondary">Discard</Button></form>
        </div>
      )}
    </>
  );
}
