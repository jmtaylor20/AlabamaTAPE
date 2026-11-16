import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteCredential, quarantineEvidence, releaseQuarantine, removeEvidence, reopenDirectorScores, rescanEvidence, saveCredential, saveSelfScore, setEvidenceLinks, submitDirectorScores } from "@/lib/actions/evidence";
import { requireUser } from "@/lib/auth/session";
import { EvidenceUpload } from "@/lib/components/evidence-upload";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { loadProgram } from "@/lib/components/program";
import { fmtBytes } from "@/lib/evidence/rules";
import { fmtDate, fmtDateTime, fmtRange, statusLabel } from "@/lib/format";
import { passRate } from "@/lib/instrument/applicability";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Program" };

export default async function ProgramPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  const { id } = await params;
  const here = `/app/programs/${id}`;
  const notices = await readNotices(searchParams);
  const data = await loadProgram(id, user);
  if (!data) notFound();
  const { dp, lea, year, catalog, school, teachers, files, credentials, form, rules, qpis, site, roles } = data;
  const evidenceFiles = files.filter((f) => f.category === "evidence");
  const otherFiles = files.filter((f) => f.category !== "evidence");
  const linked = new Map<string, number>();
  for (const f of evidenceFiles) if (f.scan_status === "clean" && !f.quarantined && !f.removed_at) for (const l of f.evidence_qpi_links as { qpi_code: string }[]) linked.set(l.qpi_code, (linked.get(l.qpi_code) ?? 0) + 1);
  const scoreFor = (code: string) => site?.scores.find((s) => s.qpi_code === code && s.scorer_role === "director");
  const required = qpis.filter((q) => q.requiredSelfScore);
  const missing = required.filter((q) => { const s = scoreFor(q.code); return !s || s.value === "NA"; });
  const credRule = rules.find((r) => r.rule_key === "credential_pass_rate");
  const threshold = credRule ? Number(credRule.threshold) : 88;
  const canScore = roles.isDirector && !!site && site.open;
  const canEditFiles = roles.district || roles.admin;

  return (
    <>
      <PageHeader eyebrow={`${lea?.name ?? ""} / ${year?.label ?? ""}`} title={`${dp.program_code} ${catalog?.name ?? "Program"}`}
        description={`${school ? `${school.school_code} ${school.name}` : "System-wide"}. ${teachers.length ? `Teachers: ${teachers.map((t) => t.display_name).join(", ")}.` : "No teachers listed."} ${dp.delivery_type}${dp.dual_scenario ? ` scenario ${dp.dual_scenario}` : ""}${dp.ase_accredited ? ", ASE accredited" : ""}${dp.epic_requested ? ", EPIC requested" : ""}.`}
        actions={<><LinkButton href="/app/programs">All programs</LinkButton><LinkButton href={`${here}/form-14-1`}>Form 14-1 {form ? <Badge tone={form.status === "submitted" ? "good" : "warn"}>{form.status}</Badge> : null}</LinkButton>{roles.staff && site && <LinkButton href={`/app/admin/reviews/${site.lea_review_id}`}>LEA review</LinkButton>}</>} />
      <Notices {...notices} />

      {site ? (
        <div className="mb-4">
          <Alert tone={site.director_submitted_at ? "success" : site.open ? "warning" : "info"} title={site.released_at ? `Selected for review. Visit ${fmtRange(site.visit_start, site.visit_end)}.` : "Selected for review"}>
            {site.director_submitted_at ? `Evidence and self-scores were submitted ${fmtDateTime(site.director_submitted_at)}. Status: ${statusLabel(site.status)}.`
              : site.open ? `Evidence is due ${fmtDate(site.scoring_extended_until ?? site.evidence_due) || "on the first of the review month"}. The CTE Director must mark 1 or 2 on 2.1.A to 2.1.D and submit.`
              : site.released_at ? "Self-scoring is closed for this program." : "Details are released on the notification date."}
          </Alert>
        </div>
      ) : (
        <div className="mb-4"><Alert tone="info">This program is not selected for review this year. Evidence uploaded here is kept for the year and can be reviewed if the program is added.</Alert></div>
      )}

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title={`Evidence files (${evidenceFiles.filter((f) => !f.removed_at).length})`}>
          {evidenceFiles.length === 0 ? <Empty>No evidence uploaded yet.</Empty> : (
            <Table caption="Evidence files" head={<tr><th className={th}>File</th><th className={th}>Supports</th><th className={th}>Status</th><th className={th}>Uploaded</th><th className={th}>Actions</th></tr>}>
              {evidenceFiles.map((f) => {
                const links = (f.evidence_qpi_links as { qpi_code: string }[]).map((l) => l.qpi_code).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
                const teacher = f.teachers as unknown as { display_name: string } | null;
                const by = f.profiles as unknown as { display_name: string } | null;
                const openable = f.scan_status === "clean" && !f.quarantined && !f.removed_at;
                return (
                  <tr key={f.id} className={f.removed_at ? "opacity-60" : ""}>
                    <td className={td}>{openable ? <a href={`/app/evidence/${f.id}`} target="_blank" rel="noopener" className="font-semibold text-brand underline">{f.original_name}</a> : <span>{f.original_name}</span>}<span className="block text-xs text-ink-muted">{fmtBytes(Number(f.size_bytes))}{teacher ? `, ${teacher.display_name}` : ""}{f.note ? `, ${f.note}` : ""}</span></td>
                    <td className={td}>{links.length ? links.map((c) => <span key={c} className="mr-1 inline-block rounded bg-brand-soft px-1 font-mono text-xs">{c}</span>) : <span className="text-ink-muted">Not linked</span>}</td>
                    <td className={td}>
                      {f.removed_at ? <Badge tone="bad">Removed</Badge> : f.quarantined ? <Badge tone="bad">Quarantined</Badge> : f.scan_status === "clean" ? <Badge tone="good">Clean</Badge> : f.scan_status === "pending" ? <Badge tone="warn">Scanning</Badge> : <Badge tone="bad">{statusLabel(f.scan_status)}</Badge>}
                      {roles.staff && f.quarantine_reason && <span className="block text-xs text-ink-muted">{f.quarantine_reason}</span>}
                      {f.scan_detail && f.scan_status !== "clean" && <span className="block text-xs text-ink-muted">{f.scan_detail}</span>}
                    </td>
                    <td className={td}>{by?.display_name ?? "Unknown"}<span className="block text-xs text-ink-muted">{fmtDateTime(f.created_at)}</span></td>
                    <td className={td}>
                      {!f.removed_at && (
                        <details className="text-sm"><summary className="cursor-pointer font-semibold text-brand">Manage</summary>
                          {canEditFiles && (
                            <form action={setEvidenceLinks} className="mt-2 flex flex-col gap-2">
                              <input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="note" value={f.note ?? ""} /><input type="hidden" name="teacher_id" value={f.teacher_id ?? ""} />
                              <div className="grid max-h-48 gap-1 overflow-y-auto rounded border border-line p-2 sm:grid-cols-2">{qpis.map((q) => <label key={q.code} className="flex items-start gap-2 text-xs"><input type="checkbox" name="qpi_codes" value={q.code} defaultChecked={links.includes(q.code)} className="mt-0.5 h-4 w-4" /><span><span className="font-mono">{q.code}</span> {q.title}</span></label>)}</div>
                              <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Save links</Button>
                            </form>
                          )}
                          {canEditFiles && (
                            <form action={removeEvidence} className="mt-2 flex items-center gap-2"><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="return_to" value={here} /><Input name="reason" placeholder="Reason (optional)" aria-label="Reason for removing" className="min-h-9 text-xs" /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Remove</Button></form>
                          )}
                          {roles.staff && !f.quarantined && (
                            <form action={quarantineEvidence} className="mt-2 flex items-center gap-2"><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="return_to" value={here} /><Input name="reason" placeholder="Reason (required)" aria-label="Reason for quarantine" required className="min-h-9 text-xs" /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Quarantine</Button></form>
                          )}
                          {roles.admin && f.quarantined && (
                            <form action={releaseQuarantine} className="mt-2 flex items-center gap-2"><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="return_to" value={here} /><Input name="reason" placeholder="Reason" aria-label="Reason for lifting quarantine" className="min-h-9 text-xs" /><Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Lift quarantine</Button></form>
                          )}
                          {roles.admin && f.scan_status !== "clean" && (
                            <form action={rescanEvidence} className="mt-2"><input type="hidden" name="file_id" value={f.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Scan again</Button></form>
                          )}
                        </details>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
          {otherFiles.length > 0 && (
            <>
              <h3 className="mt-4 text-sm font-semibold">Reports and prior-year forms</h3>
              <ul className="divide-y divide-line text-sm">{otherFiles.filter((f) => !f.removed_at).map((f) => <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span>{f.scan_status === "clean" && !f.quarantined ? <a href={`/app/evidence/${f.id}`} target="_blank" rel="noopener" className="text-brand underline">{f.original_name}</a> : f.original_name} <Badge>{statusLabel(f.category)}{f.form_year_label ? ` ${f.form_year_label}` : ""}</Badge></span><Badge tone={f.scan_status === "clean" ? "good" : "warn"}>{f.quarantined ? "Quarantined" : statusLabel(f.scan_status)}</Badge></li>)}</ul>
            </>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          {roles.canUpload && (
            <Card title="Upload evidence">
              <EvidenceUpload declaredProgramId={dp.id} qpis={qpis.map((q) => ({ code: q.code, title: q.title }))} teachers={teachers} categories={[{ value: "evidence", label: "Evidence for a quality indicator" }, { value: "spp_report", label: "SPP credential report (QPI 2.1.H)" }, { value: "credential_report", label: "Certification agency report" }]} />
            </Card>
          )}
          <Card title="Industry credentials (QPI 2.1.H)">
            <p className="mb-2 text-sm text-ink-muted">Students who sat for a credential and how many passed. Level 2 needs {threshold} percent or more{credRule?.epic_threshold ? `; EPIC needs ${Number(credRule.epic_threshold)} percent` : ""}.</p>
            {credentials.length === 0 ? <Empty>No credential counts entered.</Empty> : (
              <ul className="divide-y divide-line text-sm">
                {credentials.map((c) => {
                  const rate = passRate(c.test_takers, c.passers);
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>{c.credential_name}: {c.passers} of {c.test_takers} passed{rate !== null && <> <Badge tone={rate >= threshold ? "good" : "warn"}>{rate}%</Badge></>}</span>
                      {roles.manages && <form action={deleteCredential}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Delete</Button></form>}
                    </li>
                  );
                })}
              </ul>
            )}
            {roles.manages && (
              <form action={saveCredential} className="mt-3 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <input type="hidden" name="id" value="" /><input type="hidden" name="declared_program_id" value={dp.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="source_file_id" value="" />
                <Input name="credential_name" placeholder="Credential name" aria-label="Credential name" required className="min-h-9 text-sm" />
                <Input name="test_takers" type="number" min={0} placeholder="Sat" aria-label="Test takers" required className="min-h-9 text-sm" />
                <Input name="passers" type="number" min={0} placeholder="Passed" aria-label="Passers" required className="min-h-9 text-sm" />
                <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Add</Button>
              </form>
            )}
          </Card>
        </div>
      </div>

      <Card title="Quality indicators and self-scores" className="mt-6">
        <p className="mb-3 text-sm text-ink-muted">
          {qpis.length} indicators apply to this program. {dp.ase_accredited && "Items marked ASE are satisfied by the accreditation evidence in 2.1.F. "}
          {site ? (roles.isDirector ? "Mark 1 or 2 for 2.1.A to 2.1.D from your own observation; the rest are optional. Every entry is kept with its version." : "Director self-scores are shown as entered.") : "Self-scores open once the program is selected and the notification is released."}
        </p>
        <Table caption="Quality indicators" head={<tr><th className={th}>QPI</th><th className={th}>Evidence</th><th className={th}>Director score</th>{canScore && <th className={th}>Score</th>}</tr>}>
          {qpis.map((q) => {
            const s = scoreFor(q.code);
            const count = linked.get(q.code) ?? 0;
            return (
              <tr key={q.code}>
                <td className={td}><span className="font-mono text-xs">{q.code}</span> {q.title}{q.requiredSelfScore && <> <Badge tone="warn">Required</Badge></>}{q.assurance_based && <> <Badge>Assurance</Badge></>}{q.onsite && <> <Badge>Onsite</Badge></>}{q.per_teacher && <> <Badge>Per teacher</Badge></>}{q.satisfiedByAse && <> <Badge tone="good">ASE</Badge></>}</td>
                <td className={`${td} tabular-nums`}>{q.satisfiedByAse ? "See 2.1.F" : count > 0 ? <Badge tone="good">{count} file{count === 1 ? "" : "s"}</Badge> : <span className="text-ink-muted">None</span>}</td>
                <td className={td}>{!site || roles.isTeacher ? <span className="text-ink-muted">{roles.isTeacher ? "Director only" : ""}</span> : s ? <><Badge tone={s.value === "2" ? "good" : s.value === "1" ? "bad" : "neutral"}>{s.value === "NA" ? "N/A" : `Level ${s.value}`}</Badge><span className="block text-xs text-ink-muted">v{s.version}, {fmtDateTime(s.created_at)}{s.na_reason ? `, ${s.na_reason}` : ""}{s.comment ? `, ${s.comment}` : ""}</span></> : <span className="text-ink-muted">Not scored</span>}</td>
                {canScore && site && (
                  <td className={td}>
                    <form action={saveSelfScore} className="flex flex-col gap-1">
                      <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="qpi_code" value={q.code} /><input type="hidden" name="return_to" value={here} />
                      <div className="flex flex-wrap gap-2 text-sm" role="radiogroup" aria-label={`Score for ${q.code}`}>
                        <label className="flex items-center gap-1"><input type="radio" name="value" value="1" defaultChecked={s?.value === "1"} required className="h-4 w-4" /> 1</label>
                        <label className="flex items-center gap-1"><input type="radio" name="value" value="2" defaultChecked={s?.value === "2"} className="h-4 w-4" /> 2</label>
                        {q.allows_na && !q.requiredSelfScore && <label className="flex items-center gap-1"><input type="radio" name="value" value="NA" defaultChecked={s?.value === "NA"} className="h-4 w-4" /> N/A</label>}
                      </div>
                      {q.allows_na && !q.requiredSelfScore && <Input name="na_reason" placeholder="Reason if N/A" aria-label={`Reason for N/A on ${q.code}`} defaultValue={s?.na_reason ?? ""} className="min-h-9 text-xs" />}
                      <Input name="comment" placeholder="Comment (optional)" aria-label={`Comment on ${q.code}`} defaultValue={s?.comment ?? ""} className="min-h-9 text-xs" />
                      <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Save</Button>
                    </form>
                  </td>
                )}
              </tr>
            );
          })}
        </Table>
      </Card>

      {site && (roles.isDirector || roles.admin) && (
        <Card title="Submit evidence and self-scores" className="mt-6">
          {site.director_submitted_at ? (
            <>
              <p className="text-sm">Submitted {fmtDateTime(site.director_submitted_at)}. Scores are frozen.</p>
              {roles.admin && (
                <form action={reopenDirectorScores} className="mt-3 flex flex-wrap items-end gap-3">
                  <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="return_to" value={here} />
                  <div className="min-w-56 flex-1"><Field id="reopen_reason" label="Reason to reopen"><Input id="reopen_reason" name="reason" required /></Field></div>
                  <Field id="reopen_until" label="Open until"><Input id="reopen_until" name="until" type="date" /></Field>
                  <Button type="submit" variant="secondary">Reopen self-scoring</Button>
                </form>
              )}
            </>
          ) : roles.isDirector ? (
            <>
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
                <li>{site.open ? <Badge tone="good">Open</Badge> : <Badge tone="warn">Closed</Badge>} Self-scoring window{site.evidence_due && ` (due ${fmtDate(site.scoring_extended_until ?? site.evidence_due)})`}</li>
                <li>{missing.length === 0 ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} A 1 or 2 on 2.1.A to 2.1.D{missing.length > 0 && ` (missing ${missing.map((q) => q.code).join(", ")})`}</li>
                <li>{evidenceFiles.some((f) => f.scan_status === "clean" && !f.removed_at) ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Recommended</Badge>} Evidence uploaded and linked to indicators</li>
              </ul>
              <form action={submitDirectorScores} className="flex flex-col gap-3">
                <input type="hidden" name="site_id" value={site.id} /><input type="hidden" name="return_to" value={here} />
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="attest" required className="mt-0.5 h-5 w-5" /> I have observed this program and the scores for 2.1.A to 2.1.D reflect what I saw. I understand these entries are subject to random audit.</label>
                <div><Button type="submit" disabled={!site.open || missing.length > 0}>Submit to ALSDE</Button></div>
              </form>
            </>
          ) : <p className="text-sm text-ink-muted">Not submitted yet.</p>}
        </Card>
      )}
    </>
  );
}
