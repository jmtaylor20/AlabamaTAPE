import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { applyMasterImport, applyScheduleImport, discardImport } from "@/lib/actions/imports";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDate, fmtDateTime, monthName } from "@/lib/format";
import type { MasterPlan, ScheduleFormRow } from "@/lib/import/master";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Button, Card, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Import preview" };

export default async function ImportPreviewPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: SearchParams }) {
  await requireRole("state_admin");
  const { jobId } = await params;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: job } = await supabase.from("import_jobs").select("*").eq("id", jobId).in("kind", ["master", "compliance_list"]).maybeSingle();
  if (!job) notFound();
  const result = job.result as Record<string, unknown> & { skipped?: string[] } | null;
  const isMaster = job.kind === "master";
  const plan = job.plan as (MasterPlan & { cycle_id: string | null }) | { rows: ScheduleFormRow[]; problems: string[]; sheet: string };
  return (
    <>
      <PageHeader eyebrow="Imports" title={`Preview: ${job.file_name}`} description={`Read ${fmtDateTime(job.created_at)}. Nothing is saved until you apply.`} actions={<LinkButton href="/app/admin/imports">Back</LinkButton>} />
      <Notices {...notices} />
      {job.status === "applied" && result && <div className="mb-4"><Alert tone="success" title="Applied">{Object.entries(result).filter(([k]) => k !== "skipped").map(([k, v]) => `${k}: ${String(v)}`).join(", ")}. {(result.skipped ?? []).length} skipped.{(result.skipped ?? []).length > 0 && <ul className="mt-2 list-disc pl-5">{(result.skipped ?? []).map((s, i) => <li key={i}>{s}</li>)}</ul>}</Alert></div>}
      {job.status === "discarded" && <div className="mb-4"><Alert tone="info">This preview was discarded.</Alert></div>}
      {isMaster ? (() => {
        const m = plan as MasterPlan & { cycle_id: string | null };
        return (
          <div className="flex flex-col gap-6">
            {m.ignored.length > 0 && <Alert tone="info">Sheets ignored (headers not recognized): {m.ignored.join(", ")}</Alert>}
            {m.catalog && <Card title={`Programs (${m.catalog.rows.length} rows from "${m.catalog.sheet}")`}><Table caption="Programs" head={<tr><th className={th}>Row</th><th className={th}>Code</th><th className={th}>Name</th><th className={th}>Cluster</th><th className={th}>Co-op</th><th className={th}>Problems</th></tr>}>{m.catalog.rows.map((r) => <tr key={r.row} className={r.problems.length ? "bg-danger-soft/40" : ""}><td className={td}>{r.row}</td><td className={`${td} font-mono`}>{r.code}</td><td className={td}>{r.name}</td><td className={td}>{r.clusterCode} {r.clusterName}</td><td className={td}>{r.isCoop ? "Yes" : ""}</td><td className={td}>{r.problems.join("; ")}</td></tr>)}</Table></Card>}
            {m.leas && <Card title={`Systems (${m.leas.rows.length} rows from "${m.leas.sheet}")`}><Table caption="Systems" head={<tr><th className={th}>Row</th><th className={th}>Code</th><th className={th}>Name</th><th className={th}>Type</th><th className={th}>Director</th><th className={th}>Problems</th></tr>}>{m.leas.rows.map((r) => <tr key={r.row} className={r.problems.length ? "bg-danger-soft/40" : ""}><td className={td}>{r.row}</td><td className={`${td} font-mono`}>{r.systemCode}</td><td className={td}>{r.name}</td><td className={td}>{r.leaType}</td><td className={td}>{r.directorName} {r.directorEmail && <span className="text-ink-muted">({r.directorEmail})</span>}</td><td className={td}>{r.problems.join("; ")}</td></tr>)}</Table></Card>}
            {m.schools && <Card title={`Schools (${m.schools.rows.length} rows from "${m.schools.sheet}")`}><Table caption="Schools" head={<tr><th className={th}>Row</th><th className={th}>System</th><th className={th}>School</th><th className={th}>Name</th><th className={th}>Type</th><th className={th}>Problems</th></tr>}>{m.schools.rows.map((r) => <tr key={r.row} className={r.problems.length ? "bg-danger-soft/40" : ""}><td className={td}>{r.row}</td><td className={`${td} font-mono`}>{r.systemCode}</td><td className={`${td} font-mono`}>{r.schoolCode}</td><td className={td}>{r.name}</td><td className={td}>{r.schoolType}</td><td className={td}>{r.problems.join("; ")}</td></tr>)}</Table></Card>}
            {m.schedule && <Card title={`Schedule (${m.schedule.rows.length} rows from "${m.schedule.sheet}")${m.cycle_id ? "" : ", no cycle chosen so it will not be loaded"}`}><Table caption="Schedule" head={<tr><th className={th}>Row</th><th className={th}>System</th><th className={th}>Review month</th><th className={th}>Problems</th></tr>}>{m.schedule.rows.map((r) => <tr key={r.row} className={r.problems.length ? "bg-danger-soft/40" : ""}><td className={td}>{r.row}</td><td className={td}>{r.systemCode} {r.systemName}</td><td className={td}>{r.reviewMonth ? `${monthName(r.reviewMonth)} ${r.reviewYear}` : ""}</td><td className={td}>{r.problems.join("; ")}</td></tr>)}</Table></Card>}
            {job.status === "previewed" && <div className="flex flex-wrap gap-3"><form action={applyMasterImport}><input type="hidden" name="job_id" value={job.id} /><Button type="submit">Apply the import</Button></form><form action={discardImport}><input type="hidden" name="job_id" value={job.id} /><input type="hidden" name="return_to" value="/app/admin/imports" /><Button type="submit" variant="secondary">Discard</Button></form></div>}
          </div>
        );
      })() : (() => {
        const s = plan as { rows: ScheduleFormRow[]; problems: string[]; sheet: string };
        return (
          <div className="flex flex-col gap-6">
            {s.problems.length > 0 && <Alert tone="danger" title="The file cannot be imported as is"><ul className="list-disc pl-5">{s.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></Alert>}
            <Card title={`Responses (${s.rows.length} rows from "${s.sheet}")`}><Table caption="Scheduling responses" head={<tr><th className={th}>Row</th><th className={th}>System</th><th className={th}>First choice</th><th className={th}>Second choice</th><th className={th}>Notes</th><th className={th}>Problems</th></tr>}>{s.rows.map((r) => <tr key={r.row} className={r.problems.length ? "bg-danger-soft/40" : ""}><td className={td}>{r.row}</td><td className={td}>{r.systemCode} {r.systemName}</td><td className={td}>{fmtDate(r.choice1Start)}{r.choice1End !== r.choice1Start && ` to ${fmtDate(r.choice1End)}`}</td><td className={td}>{r.choice2Start ? `${fmtDate(r.choice2Start)}${r.choice2End !== r.choice2Start ? ` to ${fmtDate(r.choice2End)}` : ""}` : ""}</td><td className={td}>{r.notes}</td><td className={td}>{r.problems.join("; ")}</td></tr>)}</Table></Card>
            {job.status === "previewed" && s.problems.length === 0 && <div className="flex flex-wrap gap-3"><form action={applyScheduleImport}><input type="hidden" name="job_id" value={job.id} /><Button type="submit">Apply the dates</Button></form><form action={discardImport}><input type="hidden" name="job_id" value={job.id} /><input type="hidden" name="return_to" value="/app/admin/imports" /><Button type="submit" variant="secondary">Discard</Button></form></div>}
          </div>
        );
      })()}
    </>
  );
}
