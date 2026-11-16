import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clearFinding, deleteAuditSample, finalizeReview, reopenReview, saveAuditSample, saveDeskAudit, saveEpicScore, saveFinding, saveReviewerScore, saveSectionComment, sendDeskAudit } from "@/lib/actions/review";
import { hasFreshMfa, requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { OnsiteChecklist } from "@/lib/components/onsite-checklist";
import { loadProgram } from "@/lib/components/program";
import { fmtDate, fmtDateTime, fmtRange, statusLabel } from "@/lib/format";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Textarea, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Review" };

/** The reviewer's workspace for one program site: desk audit, scores, EPIC, audit samples, onsite checklist, findings, finalization. */
export default async function ReviewWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { id } = await params;
  const here = `/app/programs/${id}/review`;
  const notices = await readNotices(searchParams);
  const data = await loadProgram(id, user);
  if (!data || !data.site || !data.roles.staff) notFound();
  const { dp, lea, year, catalog, school, teachers, files, qpis, site, sections, subitems, descriptors, roles } = data;
  const canWrite = (roles.isReviewer || roles.admin) && !site.locked;
  const reviewerScore = (code: string) => site.scores.find((s) => s.qpi_code === code && s.scorer_role === "reviewer");
  const directorScore = (code: string) => site.scores.find((s) => s.qpi_code === code && s.scorer_role === "director");
  const linked = new Map<string, number>();
  for (const f of files) if (f.category === "evidence" && f.scan_status === "clean" && !f.quarantined && !f.removed_at) for (const l of f.evidence_qpi_links as { qpi_code: string }[]) linked.set(l.qpi_code, (linked.get(l.qpi_code) ?? 0) + 1);
  const required = new Set(site.applicableCodes);
  const missing = qpis.filter((q) => required.has(q.code) && !reviewerScore(q.code)).map((q) => q.code);
  const onsiteItems = qpis.filter((q) => q.onsite || q.code === "5.2.A").flatMap((q) => subitems.filter((s) => s.qpi_id === q.id).map((s) => ({ qpiCode: q.code, qpiTitle: q.title, subitemId: s.id, text: s.text, allowsNa: s.allows_na })));
  const savedChecks = Object.fromEntries(site.checks.map((c) => [c.subitem_id, { state: c.state, note: c.note }]));
  const fresh = hasFreshMfa(user);
  const auditKinds = [["assurance", "Director assurance (2.1.A to D)"], ["safety_exam", "Safety exam (2.1.F)"], ["ctip", "CTIP (2.1.F)"], ["training_agreement", "Training agreement (5.2.A)"], ["other", "Other"]] as const;

  return (
    <>
      <PageHeader eyebrow={`${lea?.name ?? ""} / ${year?.label ?? ""} / Review`} title={`${dp.program_code} ${catalog?.name ?? "Program"}`}
        description={`${school ? `${school.school_code} ${school.name}` : "System-wide"}. ${teachers.map((t) => t.display_name).join(", ") || "No teachers listed"}. Visit ${fmtRange(site.visit_start, site.visit_end)}. Reviewers: ${site.reviewers.map((r) => r.display_name ?? r.email).join(", ") || "none"}.`}
        actions={<><LinkButton href={`/app/programs/${id}`}>Evidence and self-scores</LinkButton><LinkButton href={`/app/programs/${id}/report`}>Report</LinkButton><LinkButton href={`/app/admin/reviews/${site.lea_review_id}`}>LEA review</LinkButton>{site.locked ? <Badge tone="good">Finalized</Badge> : <Badge>{statusLabel(site.status)}</Badge>}</>} />
      <Notices {...notices} />
      {site.locked && <div className="mb-4"><Alert tone="success">Finalized {fmtDateTime(site.finalized_at)}. Scores, findings, checks, and samples are locked. Only the State Admin can reopen, with a reason.</Alert></div>}
      {!roles.isReviewer && !roles.admin && <div className="mb-4"><Alert tone="info">You are viewing this review. Only assigned reviewers and the State Admin can enter records.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Desk audit">
          <p className="mb-2 text-sm text-ink-muted">Initial findings from the uploaded evidence, sent to the Director before the visit. {site.deskAudit?.sent_at ? `Sent ${fmtDateTime(site.deskAudit.sent_at)}.` : "Not sent yet."}</p>
          <form action={saveDeskAudit} className="flex flex-col gap-2">
            <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="return_to" value={here} />
            <Textarea name="initial_findings" aria-label="Initial findings" defaultValue={site.deskAudit?.initial_findings ?? ""} disabled={!canWrite || !!site.deskAudit?.sent_at} className="min-h-40" />
            {canWrite && !site.deskAudit?.sent_at && <div className="flex flex-wrap gap-2"><Button type="submit" variant="secondary">Save draft</Button></div>}
          </form>
          {canWrite && site.deskAudit && !site.deskAudit.sent_at && <form action={sendDeskAudit} className="mt-2"><input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit">Send to the Director</Button></form>}
        </Card>

        <Card title="Finalize">
          <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
            <li>{missing.length === 0 ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} Reviewer score on every applicable indicator{missing.length > 0 && ` (missing ${missing.join(", ")})`}</li>
            <li>{site.meetings.length ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} Consistency meeting recorded for this system{site.meetings[0] && ` (${fmtDate(site.meetings[0].held_on)})`}</li>
            <li>{fresh ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} Authenticator verified within the last ten minutes</li>
          </ul>
          {site.locked ? (
            roles.admin ? (
              <form action={reopenReview} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="program_review_id" value={site.program_review_id} /><input type="hidden" name="return_to" value={here} />
                <div className="min-w-56 flex-1"><Field id="reopen" label="Reason to reopen"><Input id="reopen" name="reason" required /></Field></div>
                <Button type="submit" variant="danger">Reopen</Button>
              </form>
            ) : <p className="text-sm text-ink-muted">Contact the State Admin to reopen.</p>
          ) : canWrite ? (
            fresh ? (
              <form action={finalizeReview} className="flex flex-col gap-3">
                <input type="hidden" name="program_review_id" value={site.program_review_id} /><input type="hidden" name="return_to" value={here} />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="attest" required className="mt-0.5 h-5 w-5" /> The consistency meeting was held and these scores are final. Every Level 1 becomes a finding.</label>
                <div><Button type="submit" disabled={missing.length > 0 || !site.meetings.length}>Finalize this review</Button></div>
              </form>
            ) : <LinkButton href={`/app/step-up?next=${encodeURIComponent(here)}`} variant="primary">Verify and continue to finalize</LinkButton>
          ) : null}
          {site.finalizations.length > 0 && <ul className="mt-3 divide-y divide-line text-sm">{site.finalizations.map((f, i) => <li key={i} className="py-1"><Badge tone={f.kind === "finalized" ? "good" : "warn"}>{statusLabel(f.kind)}</Badge> {fmtDateTime(f.created_at)}{f.reason ? `: ${f.reason}` : ""}</li>)}</ul>}
        </Card>
      </div>

      <Card title="Scores" className="mt-6">
        <p className="mb-3 text-sm text-ink-muted">Level 2 is the minimum for a quality program. A Level 1 becomes a finding at finalization and needs a comment, which becomes the finding text. Every entry is kept with its version.</p>
        <Table caption="Reviewer scores" head={<tr><th className={th}>QPI</th><th className={th}>Evidence</th><th className={th}>Director</th><th className={th}>Reviewer</th>{canWrite && <th className={th}>Enter</th>}</tr>}>
          {qpis.map((q) => {
            const r = reviewerScore(q.code);
            const d = directorScore(q.code);
            const applies = required.has(q.code);
            return (
              <tr key={q.code} className={applies ? "" : "opacity-60"}>
                <td className={td}><span className="font-mono text-xs">{q.code}</span> {q.title}{!applies && <> <Badge tone="good">ASE</Badge></>}{q.per_teacher && <> <Badge>Per teacher</Badge></>}{q.random_audit_kind && <> <Badge tone="warn">Audit</Badge></>}</td>
                <td className={`${td} tabular-nums`}>{linked.get(q.code) ?? 0}</td>
                <td className={td}>{d ? <Badge tone={d.value === "2" ? "good" : d.value === "1" ? "bad" : "neutral"}>{d.value === "NA" ? "N/A" : d.value}</Badge> : <span className="text-ink-muted">None</span>}</td>
                <td className={td}>{r ? <><Badge tone={r.value === "2" ? "good" : r.value === "1" ? "bad" : "neutral"}>{r.value === "NA" ? "N/A" : `Level ${r.value}`}</Badge><span className="block text-xs text-ink-muted">v{r.version}{r.na_reason ? `, ${r.na_reason}` : ""}{r.comment ? `, ${r.comment}` : ""}</span></> : <span className="text-ink-muted">Not scored</span>}</td>
                {canWrite && (
                  <td className={td}>
                    {applies && (
                      <form action={saveReviewerScore} className="flex flex-col gap-1">
                        <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="qpi_code" value={q.code} /><input type="hidden" name="return_to" value={here} />
                        <div className="flex flex-wrap gap-2 text-sm" role="radiogroup" aria-label={`Reviewer score for ${q.code}`}>
                          <label className="flex items-center gap-1"><input type="radio" name="value" value="1" defaultChecked={r?.value === "1"} required className="h-4 w-4" /> 1</label>
                          <label className="flex items-center gap-1"><input type="radio" name="value" value="2" defaultChecked={r?.value === "2"} className="h-4 w-4" /> 2</label>
                          {q.allows_na && <label className="flex items-center gap-1"><input type="radio" name="value" value="NA" defaultChecked={r?.value === "NA"} className="h-4 w-4" /> N/A</label>}
                        </div>
                        {q.allows_na && <Input name="na_reason" placeholder="Reason if N/A" aria-label={`Reason for N/A on ${q.code}`} defaultValue={r?.na_reason ?? ""} className="min-h-9 text-xs" />}
                        <Input name="comment" placeholder="Comment (required for a 1)" aria-label={`Comment on ${q.code}`} defaultValue={r?.comment ?? ""} className="min-h-9 text-xs" />
                        <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Save</Button>
                      </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Onsite checklist">
          <p className="mb-3 text-sm text-ink-muted">Works without a signal. Taps are saved on this device and sent when a connection returns.</p>
          <OnsiteChecklist siteId={site.id} items={onsiteItems} saved={savedChecks} locked={!canWrite} />
        </Card>
        <Card title="Random audits">
          <p className="mb-2 text-sm text-ink-muted">Record how many items you sampled and how many passed. Counts only; never a student or teacher name.</p>
          {site.samples.length === 0 ? <Empty>No samples recorded.</Empty> : (
            <ul className="divide-y divide-line text-sm">{site.samples.map((s) => <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><span className="font-mono text-xs">{s.qpi_code}</span> {statusLabel(s.kind)}: {s.items_passed} of {s.items_sampled} passed{s.notes ? `, ${s.notes}` : ""}</span>{canWrite && <form action={deleteAuditSample}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Remove</Button></form>}</li>)}</ul>
          )}
          {canWrite && (
            <form action={saveAuditSample} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="return_to" value={here} />
              <Field id="as_qpi" label="Indicator"><Select id="as_qpi" name="qpi_code">{qpis.filter((q) => q.random_audit_kind || q.assurance_based).map((q) => <option key={q.code} value={q.code}>{q.code} {q.title}</option>)}</Select></Field>
              <Field id="as_kind" label="Kind"><Select id="as_kind" name="kind">{auditKinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <Field id="as_sampled" label="Items sampled"><Input id="as_sampled" name="items_sampled" type="number" min={0} required /></Field>
              <Field id="as_passed" label="Items passed"><Input id="as_passed" name="items_passed" type="number" min={0} required /></Field>
              <div className="sm:col-span-2"><Field id="as_notes" label="Notes (no names)"><Input id="as_notes" name="notes" /></Field></div>
              <div><Button type="submit" variant="secondary">Record sample</Button></div>
            </form>
          )}
        </Card>
      </div>

      {site.epic && (
        <Card title="EPIC descriptors" className="mt-6">
          <p className="mb-3 text-sm text-ink-muted">Requested by the LEA. Each descriptor is Met, Not met, or N/A with a reason. EPIC is evaluated separately from the Level 2 standard.</p>
          {sections.map((sec) => {
            const list = descriptors.filter((d) => d.section_id === sec.id);
            if (!list.length) return null;
            return (
              <section key={sec.id} className="mb-4">
                <h3 className="font-semibold">{sec.code} {sec.title}</h3>
                <ul className="divide-y divide-line text-sm">
                  {list.map((d) => {
                    const cur = site.epicScores.find((e) => e.descriptor_id === d.id);
                    return (
                      <li key={d.id} className="grid gap-2 py-2 lg:grid-cols-[3fr_2fr]">
                        <span>{d.text}{cur && <> <Badge tone={cur.value === "met" ? "good" : cur.value === "not_met" ? "bad" : "neutral"}>{statusLabel(cur.value)}</Badge></>}</span>
                        {canWrite && (
                          <form action={saveEpicScore} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="descriptor_id" value={d.id} /><input type="hidden" name="return_to" value={here} />
                            <Select name="value" aria-label="EPIC result" defaultValue={cur?.value ?? "met"} className="min-h-9 max-w-32 text-xs"><option value="met">Met</option><option value="not_met">Not met</option><option value="NA">N/A</option></Select>
                            <Input name="na_reason" placeholder="Reason if N/A" aria-label="Reason if N/A" defaultValue={cur?.na_reason ?? ""} className="min-h-9 max-w-40 text-xs" />
                            <Input name="comment" placeholder="Comment" aria-label="Comment" defaultValue={cur?.comment ?? ""} className="min-h-9 max-w-40 text-xs" />
                            <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Save</Button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Section comments">
          {sections.map((sec) => {
            const mine = site.comments.find((c) => c.section_code === sec.code && c.author_role === "reviewer");
            const director = site.comments.find((c) => c.section_code === sec.code && c.author_role === "director");
            return (
              <details key={sec.id} className="border-b border-line py-2 text-sm">
                <summary className="cursor-pointer font-semibold">{sec.code} {sec.title}{mine && <> <Badge tone="good">Commented</Badge></>}</summary>
                {director && <p className="mt-1 text-ink-muted">Director: {director.body}</p>}
                <form action={saveSectionComment} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="section_code" value={sec.code} /><input type="hidden" name="author_role" value="reviewer" /><input type="hidden" name="return_to" value={here} />
                  <Textarea name="body" aria-label={`Comment on section ${sec.code}`} defaultValue={mine?.body ?? ""} disabled={!canWrite} />
                  {canWrite && <div><Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Save comment</Button></div>}
                </form>
              </details>
            );
          })}
        </Card>
        <Card title="Findings">
          <p className="mb-2 text-sm text-ink-muted">Created from every reviewer Level 1 at finalization. You can draft them earlier, tag one to a teacher, and clear them when evidence arrives.</p>
          {site.findings.length === 0 ? <Empty>No findings.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {site.findings.map((f) => (
                <li key={f.id} className="py-2">
                  <p><span className="font-mono text-xs">{f.qpi_code}</span> <Badge tone={f.status === "open" ? "bad" : "good"}>{statusLabel(f.status)}</Badge> {f.teacher_id && <Badge>{teachers.find((t) => t.id === f.teacher_id)?.display_name ?? "Teacher"}</Badge>} {f.body}</p>
                  {f.status === "cleared" && <p className="text-xs text-ink-muted">Cleared {fmtDateTime(f.cleared_at)}: {f.clearing_note}</p>}
                  {canWrite && f.status === "open" && (
                    <details className="mt-1"><summary className="cursor-pointer text-xs font-semibold text-brand">Edit or clear</summary>
                      <form action={saveFinding} className="mt-1 flex flex-col gap-1">
                        <input type="hidden" name="id" value={f.id} /><input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="qpi_code" value={f.qpi_code} /><input type="hidden" name="return_to" value={here} />
                        <Textarea name="body" aria-label="Finding text" defaultValue={f.body} className="min-h-20" />
                        {teachers.length > 1 && <Select name="teacher_id" aria-label="Teacher" defaultValue={f.teacher_id ?? ""} className="min-h-9 text-xs"><option value="">Whole program</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select>}
                        {teachers.length <= 1 && <input type="hidden" name="teacher_id" value={f.teacher_id ?? ""} />}
                        <div><Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Save</Button></div>
                      </form>
                      <form action={clearFinding} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={f.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="file_id" value="" />
                        <Input name="note" placeholder="What evidence cleared it" aria-label="Clearing note" required className="min-h-9 text-xs" />
                        <Button type="submit" className="min-h-9 px-3 text-xs">Clear finding</Button>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canWrite && (
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-brand">Add a finding by hand</summary>
              <form action={saveFinding} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="id" value="" /><input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="return_to" value={here} />
                <Select name="qpi_code" aria-label="Indicator" className="min-h-9 text-xs">{qpis.map((q) => <option key={q.code} value={q.code}>{q.code} {q.title}</option>)}</Select>
                <Select name="teacher_id" aria-label="Teacher" defaultValue="" className="min-h-9 text-xs"><option value="">Whole program</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select>
                <Textarea name="body" aria-label="Finding text" className="min-h-20" required />
                <div><Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Add finding</Button></div>
              </form>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}
