import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { assignReviewer, nominate, releaseNotification, removeSelection, revokeAssignment, runDraw, saveProgramReviewNotes, saveSchedule, setLeaReviewStatus, setTarget } from "@/lib/actions/cycles";
import { saveConsistencyMeeting } from "@/lib/actions/review";
import { DraftButtons } from "@/lib/components/draft-buttons";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { eligibilityReason, fmtDate, fmtDateTime, fmtRange, monthName, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Textarea, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "LEA review" };

const MILESTONES: [string, string][] = [["check_in", "Check-in with the Director"], ["notification", "Notification"], ["evidence_due", "Evidence due"], ["visit_start", "Visit begins"], ["visit_end", "Visit ends"], ["ten_day_close", "Ten-day follow-up closes"], ["pip_start", "PIP begins"], ["pip_due", "PIP due"]];
const LEA_STATUSES = ["listed", "selected", "scheduled", "checked_in", "released", "evidence_due", "desk_audit", "onsite", "post_visit", "concluded"];
const PROGRAM_STATUSES = ["selected", "released", "evidence_submitted", "desk_audit", "onsite", "post_visit", "finalized", "concluded"];

type Assignment = { id: string; email: string; display_name: string | null; assignment_role: string; revoked_at: string | null; user_id: string | null };
type ProgramReview = { id: string; program_code: string; status: string; visit_date: string | null; sequence: number | null; pip_expected: boolean; notes: string | null; epic: boolean; selection_id: string | null; finalized_at: string | null; review_assignments: Assignment[] };

export default async function LeaReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const user = await requireUser();
  if (!user.isStaff) notFound();
  const { id } = await params;
  const here = `/app/admin/reviews/${id}`;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: review } = await supabase.from("lea_reviews").select("*, leas(system_code, name, code_is_placeholder), review_cycles(id, name, school_year_id, target_percent, school_years(label))").eq("id", id).maybeSingle();
  if (!review) notFound();
  const lea = review.leas as unknown as { system_code: string; name: string; code_is_placeholder: boolean };
  const cycle = review.review_cycles as unknown as { id: string; name: string; school_year_id: string; target_percent: number; school_years: { label: string } | null };
  const admin = user.isStateAdmin;
  const released = !!review.released_at;

  const [{ data: declared }, { data: selections }, { data: programReviews }, { data: milestones }, { data: draws }, { data: changes }, { data: contacts }, target, { data: meetings }] = await Promise.all([
    supabase.from("declared_programs").select("id, program_code, delivery_type, dual_scenario, status, excluded_reason, vacant, first_year_teacher, location_lea_id, lea_id, ase_accredited, epic_requested, program_catalog(name, cluster_code, active), home:schools!declared_programs_home_school_id_fkey(name, school_code), declared_program_teachers(teachers(display_name))").eq("lea_id", review.lea_id).eq("school_year_id", cycle.school_year_id).order("program_code"),
    supabase.from("selections").select("id, declared_program_id, method, status, nomination_reason, removal_reason, nominated_by").eq("lea_review_id", id),
    supabase.from("program_reviews").select("id, program_code, status, visit_date, sequence, pip_expected, notes, epic, selection_id, finalized_at, review_assignments(id, email, display_name, assignment_role, revoked_at, user_id)").eq("lea_review_id", id).order("sequence"),
    supabase.from("milestones").select("kind, computed_on, override_on, completed_at").eq("lea_review_id", id),
    supabase.from("selection_draws").select("id, seed, target_count, result, ran_at, pool, excluded").eq("lea_review_id", id).order("ran_at", { ascending: false }),
    supabase.from("scope_changes").select("id, kind, reason, details, occurred_at").eq("lea_review_id", id).order("occurred_at", { ascending: false }),
    supabase.from("lea_contacts").select("display_name, email, contact_role").eq("lea_id", review.lea_id).eq("active", true),
    supabase.rpc("selection_target", { p_lea_review: id }),
    supabase.from("consistency_meetings").select("id, held_on, attendees, notes").eq("lea_review_id", id).order("held_on", { ascending: false }),
  ]);
  const selByProgram = new Map((selections ?? []).map((s) => [s.declared_program_id, s]));
  const activePrograms = ((programReviews ?? []) as unknown as ProgramReview[]).filter((p) => p.status !== "removed");
  const missingReviewer = activePrograms.filter((p) => !p.review_assignments.some((a) => !a.revoked_at && a.assignment_role !== "cluster_admin"));
  const canNominate = !released && (user.roles.has("reviewer") || user.roles.has("cluster_admin") || admin);
  const canEditDates = admin || (!released && user.roles.has("reviewer"));
  const assignedHere = activePrograms.some((p) => p.review_assignments.some((a) => !a.revoked_at && (a.user_id === user.id || a.email === user.email)));

  return (
    <>
      <PageHeader eyebrow={`${cycle.name} / ${monthName(review.review_month)} ${review.review_year}`} title={lea.name}
        description={`System ${lea.code_is_placeholder ? "code pending" : lea.system_code}. ${released ? `Notification released ${fmtDateTime(review.released_at)}.` : "Not released. The system can see only that it is on the list and the notification date."}`}
        actions={<><LinkButton href={`/app/admin/cycles/${cycle.id}`}>Back to cycle</LinkButton>{released ? <Badge tone="good">Released</Badge> : <Badge tone="warn">Embargoed</Badge>}</>} />
      <Notices {...notices} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Milestones">
          <ul className="divide-y divide-line text-sm">
            {MILESTONES.map(([kind, label]) => {
              const m = (milestones ?? []).find((x) => x.kind === kind);
              return <li key={kind} className="flex items-center justify-between gap-3 py-2"><span>{label}</span><span className="tabular-nums">{fmtDate(m?.override_on ?? m?.computed_on) || "Not set"}{m?.completed_at && <> <Badge tone="good">Done</Badge></>}</span></li>;
            })}
          </ul>
          <p className="mt-3 text-xs text-ink-muted">Notification is the 13th of the month before the review (two months before for January), moved to the prior Friday on a weekend or holiday. Evidence is due on the first of the review month unless the cycle sets a January date.</p>
        </Card>

        <Card title="Schedule" className="lg:col-span-2">
          <form action={saveSchedule} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="lea_review_id" value={id} />
            <fieldset className="contents" disabled={!canEditDates}>
              <Field id="c1s" label="Choice 1 begins"><Input id="c1s" name="choice1_start" type="date" defaultValue={review.choice1_start ?? ""} /></Field>
              <Field id="c1e" label="Choice 1 ends"><Input id="c1e" name="choice1_end" type="date" defaultValue={review.choice1_end ?? ""} /></Field>
              <Field id="c2s" label="Choice 2 begins"><Input id="c2s" name="choice2_start" type="date" defaultValue={review.choice2_start ?? ""} /></Field>
              <Field id="c2e" label="Choice 2 ends"><Input id="c2e" name="choice2_end" type="date" defaultValue={review.choice2_end ?? ""} /></Field>
              <Field id="vs" label="Visit begins" hint="The dates the system is told. Defaults to choice 1."><Input id="vs" name="visit_start" type="date" defaultValue={review.visit_start ?? ""} /></Field>
              <Field id="ve" label="Visit ends"><Input id="ve" name="visit_end" type="date" defaultValue={review.visit_end ?? ""} /></Field>
              <div className="sm:col-span-2"><Field id="notes" label="Scheduling notes"><Textarea id="notes" name="notes" defaultValue={review.notes ?? ""} /></Field></div>
              {released && <div className="sm:col-span-2"><Field id="reason" label="Reason for changing the dates after release" hint="Required if the visit dates change. Recorded and shared with the system."><Input id="reason" name="reason" /></Field></div>}
              <div className="sm:col-span-2 flex flex-wrap items-center gap-3"><Button type="submit" variant="secondary">Save schedule</Button><span className="text-sm text-ink-muted">Current visit: {fmtRange(review.visit_start, review.visit_end)}</span></div>
            </fieldset>
          </form>
          {!canEditDates && <p className="mt-2 text-sm text-ink-muted">Only the State Admin can change dates after release.</p>}
        </Card>
      </div>

      <Card title="Programs" className="mt-6">
        <p className="mb-3 text-sm text-ink-muted">Every program this system declared for {cycle.school_years?.label}. Nominated and drawn programs become program reviews. {!released && "Nothing here is visible to the system until release."}</p>
        {(declared ?? []).length === 0 ? <Empty>No declared programs for this system and school year. Import or enter declarations first.</Empty> : (
          <Table caption="Declared programs" head={<tr><th className={th}>Program</th><th className={th}>School</th><th className={th}>Teachers</th><th className={th}>Delivery</th><th className={th}>Eligibility</th><th className={th}>Selection</th><th className={th}>Action</th></tr>}>
            {(declared ?? []).map((d) => {
              const cat = d.program_catalog as unknown as { name: string; cluster_code: string; active: boolean } | null;
              const school = d.home as unknown as { name: string; school_code: string } | null;
              const teachers = ((d.declared_program_teachers as unknown as { teachers: { display_name: string } | null }[]) ?? []).map((t) => t.teachers?.display_name).filter(Boolean).join(", ");
              const why = eligibilityReason(d, cat?.active ?? true);
              const sel = selByProgram.get(d.id);
              return (
                <tr key={d.id}>
                  <td className={td}><span className="font-mono text-xs">{d.program_code}</span> {cat?.name}{d.epic_requested && <> <Badge tone="good">EPIC</Badge></>}{d.ase_accredited && <> <Badge>ASE</Badge></>}</td>
                  <td className={td}>{school ? `${school.school_code} ${school.name}` : "System-wide"}</td>
                  <td className={td}>{teachers || <span className="text-ink-muted">None listed</span>}</td>
                  <td className={td}>{d.delivery_type}{d.dual_scenario ? ` ${d.dual_scenario}` : ""}</td>
                  <td className={td}>{why ? <Badge tone="warn">{why}</Badge> : <Badge tone="good">Eligible</Badge>}</td>
                  <td className={td}>{sel ? sel.status === "removed" ? <Badge tone="bad">Removed</Badge> : <Badge tone="good">{statusLabel(sel.method)}</Badge> : <span className="text-ink-muted">In the pool</span>}{sel?.nomination_reason && <p className="text-xs text-ink-muted">{sel.nomination_reason}</p>}</td>
                  <td className={td}>
                    {!sel && !why && canNominate && (
                      <form action={nominate} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="lea_review_id" value={id} /><input type="hidden" name="declared_program_id" value={d.id} /><input type="hidden" name="return_to" value={here} />
                        <Input name="reason" placeholder="Reason (optional)" aria-label="Nomination reason" className="min-h-9 max-w-48 text-sm" />
                        <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">{admin ? "Add" : "Nominate"}</Button>
                      </form>
                    )}
                    {sel && sel.status === "active" && admin && !released && (
                      <form action={removeSelection} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="selection_id" value={sel.id} /><input type="hidden" name="lea_review_id" value={id} />
                        <Input name="reason" placeholder="Reason" aria-label="Removal reason" required className="min-h-9 max-w-48 text-sm" />
                        <Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Remove</Button>
                      </form>
                    )}
                    {sel && sel.status === "active" && admin && released && (
                      <form action={removeSelection} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="selection_id" value={sel.id} /><input type="hidden" name="lea_review_id" value={id} />
                        <Input name="reason" placeholder="Reason (shared with the system)" aria-label="Removal reason" required className="min-h-9 max-w-56 text-sm" />
                        <Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Remove after release</Button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Random draw">
          <p className="text-sm">Target for this system: <strong className="tabular-nums">{target.data ?? 0}</strong> program{target.data === 1 ? "" : "s"}{review.target_override !== null ? ` (override: ${review.target_override_reason})` : ` (${Number(cycle.target_percent)} percent of eligible, rounded up, at least one)`}. Nominations count toward the target.</p>
          {admin && !released && (
            <>
              <form action={runDraw} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="lea_review_id" value={id} />
                <div className="min-w-56 flex-1"><Field id="seed" label="Seed" hint="Any text. The same seed always produces the same draw."><Input id="seed" name="seed" defaultValue={`${lea.system_code}-${review.review_year}-${review.review_month}`} required /></Field></div>
                <Button type="submit">Run the draw</Button>
              </form>
              <form action={setTarget} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="lea_review_id" value={id} />
                <Field id="t_override" label="Override the count"><Input id="t_override" name="target_override" type="number" min={0} defaultValue={review.target_override ?? ""} className="max-w-32" /></Field>
                <div className="min-w-56 flex-1"><Field id="t_reason" label="Reason"><Input id="t_reason" name="reason" required /></Field></div>
                <Button type="submit" variant="secondary">Save override</Button>
              </form>
            </>
          )}
          {(draws ?? []).length > 0 && (
            <ul className="mt-4 divide-y divide-line text-sm">
              {(draws ?? []).map((dr) => <li key={dr.id} className="py-2">{fmtDateTime(dr.ran_at)}: seed <code className="rounded bg-brand-soft px-1">{dr.seed}</code>, target {dr.target_count}, pool {(dr.pool as unknown[]).length}, excluded {(dr.excluded as unknown[]).length}, drew {(dr.result as unknown[]).length}.</li>)}
            </ul>
          )}
        </Card>

        <Card title="Release the notification">
          {released ? (
            <Alert tone="success">Released {fmtDateTime(review.released_at)}. The Director, teachers on the selected programs, and the reviewers can see the programs, the reviewers, and the dates. Changes from here on are recorded as scope changes with a reason.</Alert>
          ) : (
            <>
              <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
                <li>{activePrograms.length > 0 ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} At least one program selected ({activePrograms.length})</li>
                <li>{review.visit_start ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} Visit dates set</li>
                <li>{missingReviewer.length === 0 && activePrograms.length > 0 ? <Badge tone="good">Ready</Badge> : <Badge tone="warn">Needed</Badge>} A reviewer on every program{missingReviewer.length > 0 && ` (${missingReviewer.length} missing)`}</li>
              </ul>
              {admin ? (
                <form action={releaseNotification} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="lea_review_id" value={id} />
                  <div className="min-w-48"><Field id="confirm" label="Type RELEASE to confirm"><Input id="confirm" name="confirm" autoComplete="off" required /></Field></div>
                  <Button type="submit">Release now</Button>
                </form>
              ) : <p className="text-sm text-ink-muted">Only the State Admin can release.</p>}
              <p className="mt-2 text-xs text-ink-muted">Release is logged with who released it and when. Email delivery is added in a later phase.</p>
            </>
          )}
          {admin && (
            <form action={setLeaReviewStatus} className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <input type="hidden" name="lea_review_id" value={id} /><input type="hidden" name="notes" value={review.notes ?? ""} />
              <Field id="status" label="Review status"><Select id="status" name="status" defaultValue={review.status}>{LEA_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select></Field>
              <Button type="submit" variant="secondary">Save status</Button>
            </form>
          )}
        </Card>
      </div>

      <Card title="Program reviews and reviewers" className="mt-6">
        {activePrograms.length === 0 ? <Empty>No program reviews yet. Nominate or draw programs above.</Empty> : (
          <div className="grid gap-4 lg:grid-cols-2">
            {activePrograms.map((p) => {
              const dp = (declared ?? []).find((d) => d.program_code === p.program_code);
              const cat = dp?.program_catalog as unknown as { name: string } | null;
              const mine = p.review_assignments.some((a) => !a.revoked_at && (a.user_id === user.id || a.email === user.email));
              return (
                <section key={p.id} className="rounded-md border border-line p-4">
                  <h3 className="font-semibold">{dp ? <Link href={`/app/programs/${dp.id}`} className="text-brand underline"><span className="font-mono text-xs">{p.program_code}</span> {cat?.name ?? "Program"}</Link> : <><span className="font-mono text-xs">{p.program_code}</span> {cat?.name ?? "Program"}</>} <Badge tone={p.finalized_at ? "good" : "neutral"}>{statusLabel(p.status)}</Badge>{p.pip_expected && <> <Badge tone="warn">PIP expected</Badge></>}{dp && released && <> <Link href={`/app/programs/${dp.id}/review`} className="text-sm font-semibold text-brand underline">Open review</Link></>}</h3>
                  <ul className="mt-2 divide-y divide-line text-sm">
                    {p.review_assignments.filter((a) => !a.revoked_at).map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 py-1">
                        <span>{a.display_name ?? a.email} <span className="text-ink-muted">({a.email})</span> <Badge>{statusLabel(a.assignment_role)}</Badge>{!a.user_id && <> <Badge tone="warn">No account yet</Badge></>}</span>
                        {admin && (
                          <form action={revokeAssignment} className="flex items-center gap-1">
                            <input type="hidden" name="id" value={a.id} /><input type="hidden" name="lea_review_id" value={id} />
                            <Input name="reason" placeholder="Reason" aria-label="Reason for removing this reviewer" required className="min-h-9 max-w-36 text-xs" />
                            <Button type="submit" variant="danger" className="min-h-9 px-2 text-xs">Remove</Button>
                          </form>
                        )}
                      </li>
                    ))}
                    {p.review_assignments.filter((a) => !a.revoked_at).length === 0 && <li className="py-1 text-ink-muted">No reviewer assigned.</li>}
                  </ul>
                  {admin && (
                    <form action={assignReviewer} className="mt-3 grid gap-2 sm:grid-cols-[2fr_2fr_1fr_auto]">
                      <input type="hidden" name="program_review_id" value={p.id} /><input type="hidden" name="lea_review_id" value={id} />
                      <Input name="email" type="email" placeholder="reviewer@example.gov" aria-label="Reviewer email" required className="min-h-9 text-sm" />
                      <Input name="display_name" placeholder="Name (optional)" aria-label="Reviewer name" className="min-h-9 text-sm" />
                      <Select name="assignment_role" aria-label="Role" defaultValue={p.review_assignments.some((a) => !a.revoked_at && a.assignment_role === "lead_reviewer") ? "reviewer" : "lead_reviewer"} className="min-h-9 text-sm"><option value="lead_reviewer">Lead</option><option value="reviewer">Reviewer</option><option value="cluster_admin">Cluster admin</option></Select>
                      <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">Assign</Button>
                    </form>
                  )}
                  {(admin || mine) && (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer font-semibold text-brand">Status, order, and notes</summary>
                      <form action={saveProgramReviewNotes} className="mt-2 grid gap-2 sm:grid-cols-3">
                        <input type="hidden" name="program_review_id" value={p.id} /><input type="hidden" name="lea_review_id" value={id} />
                        <Field id={`st-${p.id}`} label="Status"><Select id={`st-${p.id}`} name="status" defaultValue={p.status}>{PROGRAM_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select></Field>
                        <Field id={`vd-${p.id}`} label="Visit date"><Input id={`vd-${p.id}`} name="visit_date" type="date" defaultValue={p.visit_date ?? ""} /></Field>
                        <Field id={`sq-${p.id}`} label="Order of review"><Input id={`sq-${p.id}`} name="sequence" type="number" min={0} defaultValue={p.sequence ?? ""} /></Field>
                        <div className="sm:col-span-3"><Field id={`nt-${p.id}`} label="Notes" hint="Completion notes, PIP notes, and anything the reviewer should know."><Textarea id={`nt-${p.id}`} name="notes" defaultValue={p.notes ?? ""} /></Field></div>
                        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="pip_expected" defaultChecked={p.pip_expected} className="h-5 w-5" /> A PIP is expected for this program</label>
                        <div><Button type="submit" variant="secondary">Save</Button></div>
                      </form>
                    </details>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="System contacts">
          {(contacts ?? []).length === 0 ? <Empty>No contacts on file. The CTE Director is listed under the system&apos;s people once invited.</Empty> : (
            <ul className="divide-y divide-line text-sm">{(contacts ?? []).map((c, i) => <li key={i} className="py-2">{c.display_name} <span className="text-ink-muted">({c.email ?? "no email"})</span> <Badge>{statusLabel(c.contact_role)}</Badge></li>)}</ul>
          )}
        </Card>
        <Card title="Messages">
          <p className="mb-2 text-sm text-ink-muted">Draft from the records, review, then approve and send. Before release, only the check-in and declaration messages can go to the district.</p>
          <DraftButtons leaReviewId={id} returnTo={here} steps={[{ step: "check_in", label: "Check-in" }, { step: "declaration_window", label: "Declaration window" }, { step: "reviewer_assignment", label: "Reviewer assignment (staff)" }, { step: "notification", label: "Notification" }, { step: "evidence_reminder", label: "Evidence reminder" }, { step: "scope_change", label: "Change notice" }]} />
        </Card>
        <Card title="Consistency meeting">
          <p className="mb-2 text-sm text-ink-muted">Reviewers compare scores across this system&apos;s programs before anything is finalized. No program review can be finalized until a meeting is recorded here.</p>
          {(meetings ?? []).length === 0 ? <Empty>No meeting recorded.</Empty> : (
            <ul className="divide-y divide-line text-sm">{(meetings ?? []).map((m) => <li key={m.id} className="py-2"><span className="font-semibold">{fmtDate(m.held_on)}</span>: {m.attendees}{m.notes && <span className="block text-ink-muted">{m.notes}</span>}</li>)}</ul>
          )}
          {(admin || assignedHere) && (
            <form action={saveConsistencyMeeting} className="mt-3 grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="lea_review_id" value={id} /><input type="hidden" name="return_to" value={here} />
              <Field id="cm_date" label="Held on"><Input id="cm_date" name="held_on" type="date" required /></Field>
              <Field id="cm_att" label="Attendees"><Input id="cm_att" name="attendees" required /></Field>
              <div className="sm:col-span-2"><Field id="cm_notes" label="Notes"><Textarea id="cm_notes" name="notes" /></Field></div>
              <div><Button type="submit" variant="secondary">Record meeting</Button></div>
            </form>
          )}
        </Card>
        <Card title="Scope changes after release">
          {(changes ?? []).length === 0 ? <Empty>No changes recorded.</Empty> : (
            <ul className="divide-y divide-line text-sm">{(changes ?? []).map((c) => <li key={c.id} className="py-2"><Badge>{statusLabel(c.kind)}</Badge> {c.reason} <span className="text-ink-muted">{fmtDateTime(c.occurred_at)}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
