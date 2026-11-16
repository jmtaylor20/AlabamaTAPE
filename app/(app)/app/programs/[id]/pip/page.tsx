import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addPipNote, closePip, concludeReview, createPip, saveGoals, saveProgress } from "@/lib/actions/pips";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { loadProgram } from "@/lib/components/program";
import { fmtDate, fmtDateTime, pipMonth, statusLabel } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Textarea, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Program Improvement Plan" };

const GOAL_STATUS: [string, string][] = [["", "Pending"], ["ten_days", "Accomplished within 10 days"], ["one_year", "Accomplished within one year"], ["not_complete", "Not complete"]];

export default async function PipPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { id } = await params;
  const here = `/app/programs/${id}/pip`;
  const notices = await readNotices(searchParams);
  const data = await loadProgram(id, user);
  if (!data || !data.site) notFound();
  const { dp, lea, year, catalog, school, teachers, files, qpis, site, roles } = data;
  const pip = site.pip;
  const canWrite = (roles.isReviewer || roles.admin) && !!pip && pip.status === "open";
  const noteRole = roles.isReviewer || roles.admin ? "reviewer" : roles.manages ? "director" : roles.isTeacher ? "teacher" : null;
  const openFindings = site.findings.filter((f) => f.status === "open");
  const cleanFiles = files.filter((f) => f.scan_status === "clean" && !f.quarantined && !f.removed_at);
  const currentMonth = pip ? pipMonth(pip.starts_on) : 1;

  return (
    <>
      <PageHeader eyebrow={`${lea?.name ?? ""} / ${year?.label ?? ""}`} title={`Program Improvement Plan: ${dp.program_code} ${catalog?.name ?? ""}`}
        description={`${school ? `${school.school_code} ${school.name}` : "System-wide"}. ${teachers.map((t) => t.display_name).join(", ") || "No teachers listed"}. Reviewers: ${site.reviewers.filter((r) => r.assignment_role !== "cluster_admin").map((r) => r.display_name ?? r.email).join(", ") || "none"}.`}
        actions={<><LinkButton href={`/app/programs/${id}`}>Program</LinkButton>{roles.staff && <LinkButton href={`/app/programs/${id}/review`}>Review</LinkButton>}{pip && <LinkButton href={`/app/programs/${id}/pip.pdf`} variant="primary">Download PIP</LinkButton>}{pip && <Badge tone={pip.status === "open" ? "warn" : "good"}>{statusLabel(pip.status)}</Badge>}</>} />
      <Notices {...notices} />

      {!pip ? (
        <Card title="No PIP yet">
          {!site.locked ? <Alert tone="info">A PIP is created after the review is finalized, from the findings that remain open.</Alert>
            : openFindings.length === 0 ? <Alert tone="success">The review is finalized with no open findings. No PIP is needed.</Alert>
            : <Alert tone="warning">{openFindings.length} open finding{openFindings.length === 1 ? "" : "s"}: {openFindings.map((f) => f.qpi_code).join(", ")}. The reviewer creates the PIP onsite with the teacher.</Alert>}
          {site.locked && openFindings.length > 0 && (roles.isReviewer || roles.admin) && (
            <form action={createPip} className="mt-3"><input type="hidden" name="program_review_id" value={site.program_review_id} /><input type="hidden" name="return_to" value={here} /><Button type="submit">Create the PIP</Button></form>
          )}
          {site.locked && openFindings.length === 0 && site.status !== "concluded" && (roles.isReviewer || roles.admin) && (
            <form action={concludeReview} className="mt-3"><input type="hidden" name="program_review_id" value={site.program_review_id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="secondary">Conclude the review</Button></form>
          )}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            {[["Ten-day window closed", fmtDate(pip.ten_day_close)], ["PIP started", fmtDate(pip.starts_on)], ["One-year completion date", fmtDate(pip.due_on)], ["Month", pip.status === "open" ? `${currentMonth} of 12` : `Closed ${fmtDate(pip.closed_at)}`]].map(([l, v]) => <Card key={l}><p className="text-lg font-semibold">{v}</p><p className="text-sm text-ink-muted">{l}</p></Card>)}
          </div>
          {pip.status === "closed" && <div className="mt-4"><Alert tone="success" title={`Closed ${fmtDateTime(pip.closed_at)}`}>{pip.close_note}</Alert></div>}
          {pip.escalations.length > 0 && <div className="mt-4"><Alert tone="warning" title="Escalations">{pip.escalations.map((e) => `Month ${e.month}: ${e.open_goals} goal${e.open_goals === 1 ? "" : "s"} open, ${fmtDate(e.notified_at)}`).join(". ")}. The cluster administrator and TAPE liaison are informed; no approval is needed.</Alert></div>}
          {site.status !== "concluded" && (roles.isReviewer || roles.admin) && (
            <form action={concludeReview} className="mt-4"><input type="hidden" name="program_review_id" value={site.program_review_id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="secondary">Conclude the review</Button></form>
          )}

          <Card title="Goals" className="mt-6">
            <p className="mb-3 text-sm text-ink-muted">One goal per finding. Action steps are written onsite with the teacher. Mark each goal accomplished within ten days, within one year, or not complete, with the date.</p>
            <form action={saveGoals}>
              <input type="hidden" name="pip_id" value={pip.id} /><input type="hidden" name="return_to" value={here} />
              <fieldset disabled={!canWrite} className="contents">
                <Table caption="PIP goals" head={<tr><th className={th}>QPI</th><th className={th}>Finding</th><th className={th}>Action steps</th><th className={th}>Date accomplished</th></tr>}>
                  {pip.goals.map((g) => {
                    const finding = site.findings.find((f) => f.id === g.finding_id);
                    const q = qpis.find((x) => x.code === g.qpi_code);
                    return (
                      <tr key={g.id}>
                        <td className={td}><span className="font-mono text-xs">{g.qpi_code}</span><span className="block text-xs text-ink-muted">{q?.title}</span></td>
                        <td className={td}>{finding ? <>{finding.body}{finding.status === "cleared" && <> <Badge tone="good">Cleared</Badge></>}</> : <span className="text-ink-muted">Added by hand</span>}</td>
                        <td className={td}><Textarea name={`steps:${g.id}`} defaultValue={g.action_steps} aria-label={`Action steps for ${g.qpi_code}`} className="min-h-20 text-sm" /></td>
                        <td className={td}>
                          <Select name={`status:${g.id}`} defaultValue={g.status ?? ""} aria-label={`Status for ${g.qpi_code}`} className="min-h-9 text-sm">{GOAL_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
                          <Input name={`date:${g.id}`} type="date" defaultValue={g.date_accomplished ?? ""} aria-label={`Date accomplished for ${g.qpi_code}`} className="mt-1 min-h-9 text-sm" />
                        </td>
                      </tr>
                    );
                  })}
                </Table>
                {canWrite && (
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_3fr]">
                    <Field id="new_qpi" label="Add a goal (optional)"><Select id="new_qpi" name="new_qpi" defaultValue=""><option value="">Indicator</option>{qpis.map((q) => <option key={q.code} value={q.code}>{q.code} {q.title}</option>)}</Select></Field>
                    <Field id="new_steps" label="Action steps"><Input id="new_steps" name="new_steps" /></Field>
                  </div>
                )}
                {canWrite && <div className="mt-3"><Button type="submit">Save goals</Button></div>}
              </fieldset>
            </form>
          </Card>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Monthly follow-up">
              <p className="mb-2 text-sm text-ink-muted">The reviewer records progress each month. A month marked lacking progress is what the escalation check looks at.</p>
              {pip.progress.length === 0 ? <Empty>No monthly entries yet.</Empty> : (
                <ul className="divide-y divide-line text-sm">{pip.progress.map((m) => <li key={m.month} className="py-2"><span className="font-semibold">Month {m.month}</span>{m.progress_lacking && <> <Badge tone="warn">Lacking progress</Badge></>}<span className="block">{m.body}</span><span className="text-xs text-ink-muted">{fmtDateTime(m.entered_at)}</span></li>)}</ul>
              )}
              {canWrite && (
                <form action={saveProgress} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="pip_id" value={pip.id} /><input type="hidden" name="return_to" value={here} />
                  <Field id="pm" label="Month"><Select id="pm" name="month" defaultValue={String(currentMonth)}>{Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>Month {m}</option>)}</Select></Field>
                  <Field id="pb" label="Progress"><Textarea id="pb" name="body" required /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="progress_lacking" className="h-5 w-5" /> Progress is lacking this month</label>
                  <div><Button type="submit" variant="secondary">Save month</Button></div>
                </form>
              )}
            </Card>
            <Card title="Notes and evidence">
              {pip.notes.length === 0 ? <Empty>No notes yet.</Empty> : (
                <ul className="divide-y divide-line text-sm">{pip.notes.map((n) => { const f = files.find((x) => x.id === n.evidence_file_id); return <li key={n.id} className="py-2"><Badge>{statusLabel(n.author_role)}</Badge> <span className="text-ink-muted">{n.author ?? ""}, {fmtDateTime(n.created_at)}</span>{n.goal_id && <span className="text-xs text-ink-muted"> on {pip.goals.find((g) => g.id === n.goal_id)?.qpi_code}</span>}<span className="block">{n.body}</span>{f && <a href={`/app/evidence/${f.id}`} target="_blank" rel="noopener" className="text-brand underline">{f.original_name}</a>}</li>; })}</ul>
              )}
              {noteRole && pip.status === "open" && (
                <form action={addPipNote} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="pip_id" value={pip.id} /><input type="hidden" name="author_role" value={noteRole} /><input type="hidden" name="return_to" value={here} />
                  <Field id="ng" label="About which goal"><Select id="ng" name="goal_id" defaultValue=""><option value="">The whole plan</option>{pip.goals.map((g) => <option key={g.id} value={g.id}>{g.qpi_code}</option>)}</Select></Field>
                  <Field id="nb" label="Note"><Textarea id="nb" name="body" required /></Field>
                  <Field id="nf" label="Attach evidence already uploaded (optional)"><Select id="nf" name="evidence_file_id" defaultValue=""><option value="">None</option>{cleanFiles.map((f) => <option key={f.id} value={f.id}>{f.original_name}</option>)}</Select></Field>
                  <div><Button type="submit" variant="secondary">Add note</Button></div>
                </form>
              )}
            </Card>
          </div>

          {roles.admin && pip.status === "open" && (
            <Card title="Close the PIP" className="mt-6">
              <form action={closePip} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="pip_id" value={pip.id} /><input type="hidden" name="return_to" value={here} />
                <div className="min-w-64 flex-1"><Field id="cn" label="Closing note" hint="What was accomplished, or why it closes incomplete."><Input id="cn" name="note" required /></Field></div>
                <Button type="submit">Close PIP</Button>
              </form>
            </Card>
          )}
        </>
      )}
    </>
  );
}
