import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reopenForm141, saveForm141, submitForm141 } from "@/lib/actions/evidence";
import { requireUser } from "@/lib/auth/session";
import { EvidenceUpload } from "@/lib/components/evidence-upload";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { loadProgram } from "@/lib/components/program";
import { fmtDateTime, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Textarea, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Form 14-1" };

/** The annual LEA self-assessment, one per program and school per year, with the four prior years alongside. */
export default async function Form141Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { id } = await params;
  const here = `/app/programs/${id}/form-14-1`;
  const notices = await readNotices(searchParams);
  const data = await loadProgram(id, user);
  if (!data) notFound();
  const { dp, lea, year, catalog, school, teachers, files, form, qpis, roles } = data;
  const supabase = await createUserClient();
  const [{ data: years }, { data: history }] = await Promise.all([
    supabase.from("school_years").select("id, label").order("label", { ascending: false }),
    supabase.from("form_141").select("id, status, submitted_at, school_years(label), declared_programs!inner(program_code, home_school_id, lea_id), form_141_items(qpi_code, score)").eq("declared_programs.lea_id", dp.lea_id).eq("declared_programs.program_code", dp.program_code).neq("declared_program_id", dp.id).order("created_at", { ascending: false }),
  ]);
  const priorLabels = (years ?? []).map((y) => y.label).filter((l) => l !== year?.label).slice(0, 6);
  const scans = files.filter((f) => f.category === "form_141_scan" && !f.removed_at);
  const items = new Map(((form?.form_141_items as { qpi_code: string; score: string | null; corrective_action: string | null }[]) ?? []).map((i) => [i.qpi_code, i]));
  const editable = roles.district && (!form || form.status === "draft");
  const level1 = qpis.filter((q) => items.get(q.code)?.score === "1");

  return (
    <>
      <PageHeader eyebrow={`${lea?.name ?? ""} / ${year?.label ?? ""}`} title={`Form 14-1: ${dp.program_code} ${catalog?.name ?? ""}`} description={`${school ? `${school.school_code} ${school.name}` : "System-wide"}. ${teachers.map((t) => t.display_name).join(", ")}. The LEA's annual self-assessment of this program against every quality indicator. Submission counts as the eGAP attestation; no signature is needed.`}
        actions={<><LinkButton href={`/app/programs/${id}`}>Back to program</LinkButton>{form && <Badge tone={form.status === "submitted" ? "good" : "warn"}>{form.status}</Badge>}</>} />
      <Notices {...notices} />
      {form?.status === "submitted" && <div className="mb-4"><Alert tone="success">Submitted {fmtDateTime(form.submitted_at)}. {roles.admin ? "You can reopen it below." : "Contact the TAPE liaison if it needs a correction."}</Alert></div>}
      {!form && !roles.district && <div className="mb-4"><Alert tone="info">The system has not started this year&apos;s Form 14-1.</Alert></div>}

      <form action={saveForm141}>
        <input type="hidden" name="form_id" value={form?.id ?? ""} /><input type="hidden" name="declared_program_id" value={dp.id} /><input type="hidden" name="return_to" value={here} />
        <Card title="Quality indicators">
          <fieldset disabled={!editable} className="contents">
            <Table caption="Form 14-1 items" head={<tr><th className={th}>QPI</th><th className={th}>Level</th><th className={th}>Corrective action if Level 1</th></tr>}>
              {qpis.map((q) => {
                const it = items.get(q.code);
                return (
                  <tr key={q.code}>
                    <td className={td}><span className="font-mono text-xs">{q.code}</span> {q.title}{q.satisfiedByAse && <> <Badge tone="good">ASE</Badge></>}</td>
                    <td className={td}>
                      <Select name={`score:${q.code}`} defaultValue={it?.score ?? ""} aria-label={`Level for ${q.code}`} className="min-h-9 max-w-28 text-sm">
                        <option value="">Not scored</option><option value="1">Level 1</option><option value="2">Level 2</option>{q.allows_na && <option value="NA">N/A</option>}
                      </Select>
                    </td>
                    <td className={td}><Input name={`action:${q.code}`} defaultValue={it?.corrective_action ?? ""} placeholder="Corrective action" aria-label={`Corrective action for ${q.code}`} className="min-h-9 text-sm" /></td>
                  </tr>
                );
              })}
            </Table>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="ta_requested_level1" defaultChecked={form?.ta_requested_level1} className="mt-0.5 h-5 w-5" /> Technical assistance requested for the Level 1 areas{level1.length > 0 && ` (${level1.map((q) => q.code).join(", ")})`}</label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="ta_requested_new_teacher" defaultChecked={form?.ta_requested_new_teacher} className="mt-0.5 h-5 w-5" /> Technical assistance requested for a new teacher</label>
              <div className="sm:col-span-2"><Field id="comments" label="Comments"><Textarea id="comments" name="comments" defaultValue={form?.comments ?? ""} /></Field></div>
            </div>
            {editable && <div className="mt-4"><Button type="submit">{form ? "Save draft" : "Start Form 14-1"}</Button></div>}
          </fieldset>
        </Card>
      </form>

      {form && (roles.isDirector || roles.admin) && (
        <Card title="Submit" className="mt-6">
          {form.status === "draft" && roles.isDirector && (
            <form action={submitForm141} className="flex flex-col gap-3">
              <input type="hidden" name="form_id" value={form.id} /><input type="hidden" name="return_to" value={here} />
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="attest" required className="mt-0.5 h-5 w-5" /> As CTE Director, I attest that this Form 14-1 reflects the program as observed and that corrective actions are planned for every Level 1 item.</label>
              <div><Button type="submit">Submit Form 14-1</Button></div>
            </form>
          )}
          {form.status === "draft" && !roles.isDirector && <p className="text-sm text-ink-muted">Only the CTE Director can submit.</p>}
          {form.status === "submitted" && roles.admin && (
            <form action={reopenForm141} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="form_id" value={form.id} /><input type="hidden" name="return_to" value={here} />
              <div className="min-w-56 flex-1"><Field id="reopen" label="Reason to reopen"><Input id="reopen" name="reason" required /></Field></div>
              <Button type="submit" variant="secondary">Reopen</Button>
            </form>
          )}
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Prior years">
          <p className="mb-2 text-sm text-ink-muted">A review needs the last four years of Form 14-1. Years completed in this app are listed; earlier years are uploaded as scans.</p>
          {(history ?? []).length === 0 && scans.length === 0 ? <Empty>No prior-year forms on file.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {(history ?? []).map((h) => {
                const yr = h.school_years as unknown as { label: string } | null;
                const ones = ((h.form_141_items as { score: string | null }[]) ?? []).filter((i) => i.score === "1").length;
                return <li key={h.id} className="flex items-center justify-between gap-2 py-2"><span>{yr?.label}: <Badge tone={h.status === "submitted" ? "good" : "warn"}>{statusLabel(h.status)}</Badge> {ones > 0 && `${ones} Level 1`}</span><span className="text-ink-muted">{fmtDateTime(h.submitted_at)}</span></li>;
              })}
              {scans.map((f) => <li key={f.id} className="flex items-center justify-between gap-2 py-2"><span>{f.form_year_label ?? "Year not given"}: {f.scan_status === "clean" && !f.quarantined ? <a href={`/app/evidence/${f.id}`} target="_blank" rel="noopener" className="text-brand underline">{f.original_name}</a> : f.original_name}</span><Badge tone={f.scan_status === "clean" ? "good" : "warn"}>{f.quarantined ? "Quarantined" : statusLabel(f.scan_status)}</Badge></li>)}
            </ul>
          )}
        </Card>
        {roles.canUpload && (
          <Card title="Upload a prior-year Form 14-1">
            <EvidenceUpload declaredProgramId={dp.id} qpis={[]} teachers={[]} categories={[{ value: "form_141_scan", label: "Scanned Form 14-1 from a prior year" }]} yearLabels={priorLabels} compact />
          </Card>
        )}
      </div>
      <p className="mt-6 text-sm text-ink-muted"><Link href="/app/programs" className="text-brand underline">All programs</Link></p>
    </>
  );
}
