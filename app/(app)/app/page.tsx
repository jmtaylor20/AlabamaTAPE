import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, fmtRange, monthName, statusLabel, todayIso, windowOpen as isWindowOpen } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Card, Empty, Facts, LinkButton, PageHeader, Stat, TaskList, TextLink } from "@/lib/ui";

export const metadata: Metadata = { title: "Home" };

type Count = { lea_id: string; lea_name: string; program_code: string; program_name: string; cluster_code: string; review_month: number; review_year: number; status: string; released: boolean; finalized: boolean; level2: number; level1: number; na: number; open_findings: number; cleared_findings: number; pip_status: string | null; pip_due: string | null };
type Task = { key: string; title: string; detail?: string; href: string; action: string; tone?: "neutral" | "warn" | "bad" };
type Milestone = { id: string; lea_review_id: string; lea_id: string; lea_name: string; kind: string; on_date: string; done: boolean; released: boolean };

const SOON_DAYS = 30;

function plusDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function milestoneLabel(kind: string) {
  return { check_in: "Check-in", notification: "Notification", evidence_due: "Evidence due", visit_start: "Visit begins", visit_end: "Visit ends", ten_day_close: "Ten-day close", pip_start: "PIP begins", pip_due: "PIP due" }[kind] ?? statusLabel(kind);
}

/**
 * Home answers one question for each role: what needs me, and when. Counts
 * are a single row; the full tables live on Reviews, Programs, and PIPs.
 * Every number comes from queries under the caller's own policies.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayIso();
  const denied = params.denied ? <div className="mb-6"><Alert tone="warning">That page is not available for your role.</Alert></div> : null;

  if (user.roles.size === 0) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.displayName}`} />
        {denied}
        <Alert tone="warning">Your account has no active role yet. Contact the TAPE coordinator.</Alert>
      </>
    );
  }
  if (user.leaIds.length > 0 && !user.isStaff) return <DistrictHome user={user} today={today} denied={denied} />;
  return <StaffHome user={user} today={today} denied={denied} />;
}

async function StaffHome({ user, today, denied }: { user: Awaited<ReturnType<typeof requireUser>>; today: string; denied: React.ReactNode }) {
  const supabase = await createUserClient();
  const { data: year } = await supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle();
  const soon = plusDays(today, SOON_DAYS);
  const [counts, { data: upcoming }, { data: drafts }, { data: pips }, { data: windows }, { data: audits }, { data: cycle }] = await Promise.all([
    supabase.rpc("review_counts", { p_school_year: year?.id ?? null }) as unknown as Promise<{ data: Count[] | null }>,
    supabase.from("calendar_items").select("*").gte("on_date", today).lte("on_date", soon).eq("done", false).order("on_date").limit(40) as unknown as Promise<{ data: Milestone[] | null }>,
    user.isStateAdmin ? supabase.from("email_drafts").select("id, status").in("status", ["draft", "approved"]) : Promise.resolve({ data: [] as { id: string; status: string }[] }),
    supabase.from("pips").select("id, status, due_on, program_reviews(program_code, lea_reviews(leas(name)))").eq("status", "open"),
    user.isStateAdmin && year ? supabase.from("declaration_windows").select("id, lea_id, closes_at, confirmed_at, closed_early_at, leas(name)").eq("school_year_id", year.id).is("confirmed_at", null).is("closed_early_at", null).gt("closes_at", `${today}T00:00:00Z`) : Promise.resolve({ data: [] }),
    supabase.from("desk_audits").select("site_id, sent_at").is("sent_at", null),
    year ? supabase.from("review_cycles").select("name").eq("school_year_id", year.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const rows = counts.data ?? [];
  const released = rows.filter((r) => r.released);
  const finalized = rows.filter((r) => r.finalized);
  const openFindings = rows.reduce((n, r) => n + Number(r.open_findings), 0);
  const openPips = pips ?? [];
  const overdue = openPips.filter((p) => p.due_on < today);
  const notifications = (upcoming ?? []).filter((m) => m.kind === "notification" && !m.released);
  const visits = (upcoming ?? []).filter((m) => m.kind === "visit_start");
  const pastVisitNotFinal = rows.filter((r) => r.released && !r.finalized && ["onsite", "post_visit"].includes(r.status));

  // Where the year stands, in one sentence.
  const stage = rows.length === 0
    ? "No systems are on the compliance list yet."
    : released.length === 0
      ? `${new Set(rows.map((r) => r.lea_id)).size} systems are on the list. No notifications have been released.`
      : finalized.length === rows.length
        ? "Every program review this year is finalized."
        : `${new Set(released.map((r) => r.lea_id)).size} of ${new Set(rows.map((r) => r.lea_id)).size} systems notified, ${finalized.length} of ${rows.length} program reviews finalized.`;

  const tasks: Task[] = [];
  if (user.isStateAdmin) {
    const waiting = (drafts ?? []).filter((d) => d.status === "draft").length;
    const approved = (drafts ?? []).filter((d) => d.status === "approved").length;
    if (waiting) tasks.push({ key: "drafts", title: `${waiting} message ${waiting === 1 ? "draft needs" : "drafts need"} approval`, href: "/app/drafts", action: "Review drafts", tone: "warn" });
    if (approved) tasks.push({ key: "approved", title: `${approved} approved ${approved === 1 ? "message is" : "messages are"} ready to send`, href: "/app/drafts", action: "Send" });
    for (const n of notifications.slice(0, 5)) tasks.push({ key: `n-${n.id}`, title: `Release ${n.lea_name}`, detail: `Notification date ${fmtDate(n.on_date)}`, href: `/app/admin/reviews/${n.lea_review_id}`, action: "Open", tone: n.on_date <= plusDays(today, 7) ? "warn" : "neutral" });
    const w = (windows ?? []) as unknown as { id: string; closes_at: string; leas: { name: string } | null }[];
    if (w.length) tasks.push({ key: "windows", title: `${w.length} declaration ${w.length === 1 ? "window is" : "windows are"} open`, detail: `Earliest closes ${fmtDate(w.map((x) => x.closes_at.slice(0, 10)).sort()[0])}`, href: "/app/admin/declarations", action: "Declarations" });
  }
  if ((audits ?? []).length && visits.length) tasks.push({ key: "audits", title: `${(audits ?? []).length} desk ${(audits ?? []).length === 1 ? "audit is" : "audits are"} drafted but not sent`, href: "/app/reviews", action: "Reviews", tone: "warn" });
  for (const r of pastVisitNotFinal.slice(0, 5)) tasks.push({ key: `f-${r.lea_id}-${r.program_code}`, title: `Finalize ${r.program_name} at ${r.lea_name}`, detail: `${monthName(r.review_month)} ${r.review_year} visit, ${statusLabel(r.status).toLowerCase()}`, href: "/app/reviews", action: "Reviews" });
  for (const p of overdue.slice(0, 5)) {
    const pr = p.program_reviews as unknown as { program_code: string; lea_reviews: { leas: { name: string } | null } | null } | null;
    tasks.push({ key: `p-${p.id}`, title: `Improvement plan past due at ${pr?.lea_reviews?.leas?.name ?? "a system"}`, detail: `Program ${pr?.program_code ?? ""}, due ${fmtDate(p.due_on)}`, href: "/app/pips", action: "Open", tone: "bad" });
  }

  const firstName = user.displayName.split(" ")[0] ?? user.displayName;
  return (
    <>
      <PageHeader eyebrow={[year?.label, cycle?.name].filter(Boolean).join(", ") || "No current school year"} title={`Good day, ${firstName}`} description={stage}
        actions={<>{user.isStateAdmin && <LinkButton href="/app/admin/cycles">Cycle</LinkButton>}<LinkButton href="/app/reviews" variant="primary">Reviews</LinkButton></>} />
      {denied}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Needs you" className="lg:col-span-3">
          <TaskList items={tasks} empty="Nothing is waiting on you right now." />
        </Card>
        <Card title={`Next ${SOON_DAYS} days`} className="lg:col-span-2" actions={<TextLink href="/app/calendar">Calendar</TextLink>}>
          {(upcoming ?? []).length === 0 ? <Empty>No milestones in the next {SOON_DAYS} days.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {(upcoming ?? []).slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="w-24 shrink-0 tabular-nums text-ink-muted">{fmtDate(m.on_date)}</span>
                  <span className="min-w-0">
                    <TextLink href={`/app/admin/reviews/${m.lea_review_id}`}>{m.lea_name}</TextLink>
                    <span className="block text-xs text-ink-muted">{milestoneLabel(m.kind)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6 rounded-card border border-line bg-surface px-5 py-4 shadow-card sm:grid-cols-4">
        <Stat value={rows.length} label="program reviews this year" detail={<TextLink href="/app/reviews" className="font-medium">All reviews</TextLink>} />
        <Stat value={finalized.length} label="finalized" detail={finalized.length ? `${finalized.reduce((n, r) => n + Number(r.level1), 0)} indicators at Level 1` : "none yet"} />
        <Stat value={openFindings} label="open findings" detail={`${rows.reduce((n, r) => n + Number(r.cleared_findings), 0)} cleared`} />
        <Stat value={openPips.length} label="open improvement plans" detail={overdue.length ? `${overdue.length} past due` : "none past due"} tone={overdue.length ? "danger" : "neutral"} />
      </div>
    </>
  );
}

async function DistrictHome({ user, today, denied }: { user: Awaited<ReturnType<typeof requireUser>>; today: string; denied: React.ReactNode }) {
  const supabase = await createUserClient();
  const leaId = user.leaIds[0]!;
  const isTeacher = user.roles.has("teacher") && !user.roles.has("cte_director") && !user.roles.has("lea_staff");
  const [{ data: lea }, { data: year }, { data: summaries }, { data: windows }] = await Promise.all([
    supabase.from("leas").select("name, system_code").eq("id", leaId).maybeSingle(),
    supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle(),
    supabase.rpc("my_lea_review_summary"),
    supabase.from("declaration_windows").select("id, closes_at, confirmed_at, closed_early_at").eq("lea_id", leaId).order("opens_at", { ascending: false }).limit(1),
  ]);
  const summary = ((summaries ?? []) as { lea_review_id: string; review_month: number; review_year: number; notification_on: string | null; released: boolean; status: string }[])[0];
  const window = (windows ?? [])[0];
  const windowOpen = isWindowOpen(window);

  const released = summary?.released
    ? await supabase.from("lea_reviews").select("visit_start, visit_end, status, milestones(kind, computed_on, override_on), program_reviews(id, program_code, status, program_catalog(name), program_review_sites(director_submitted_at))").eq("id", summary.lea_review_id).maybeSingle()
    : { data: null };
  const r = released.data as unknown as { visit_start: string | null; visit_end: string | null; status: string; milestones: { kind: string; computed_on: string | null; override_on: string | null }[]; program_reviews: { id: string; program_code: string; status: string; program_catalog: { name: string } | null; program_review_sites: { director_submitted_at: string | null }[] }[] } | null;
  const evidenceDue = r?.milestones.find((m) => m.kind === "evidence_due");
  const dueOn = evidenceDue?.override_on ?? evidenceDue?.computed_on ?? null;
  const programs = (r?.program_reviews ?? []).filter((p) => p.status !== "removed");
  const unsubmitted = programs.filter((p) => !p.program_review_sites.some((s) => s.director_submitted_at));

  // One sentence, one next step.
  let headline: string;
  let detail: string;
  let action: { href: string; label: string } | null = null;
  let tone: "info" | "warning" | "success" = "info";
  if (!summary) {
    headline = "Your system is not on this year's compliance list.";
    detail = "Keep your declared programs current. The list for next year is drawn from them.";
  } else if (!summary.released) {
    headline = `A TAPE review is scheduled for ${monthName(summary.review_month)} ${summary.review_year}.`;
    detail = summary.notification_on ? `The programs selected, the reviewers, and the dates are released on ${fmtDate(summary.notification_on)}.` : "The programs selected, the reviewers, and the dates are released on the notification date.";
  } else if (unsubmitted.length && dueOn && dueOn >= today) {
    headline = `Evidence and self-scores are due ${fmtDate(dueOn)}.`;
    detail = `${unsubmitted.length} of ${programs.length} selected ${programs.length === 1 ? "program has" : "programs have"} not been submitted. Visit ${fmtRange(r?.visit_start, r?.visit_end)}.`;
    action = { href: "/app/programs", label: "Open programs" };
    tone = "warning";
  } else if (unsubmitted.length) {
    headline = "The evidence deadline has passed.";
    detail = `${unsubmitted.length} ${unsubmitted.length === 1 ? "program is" : "programs are"} still unsubmitted. Contact your reviewer if you need the window extended.`;
    action = { href: "/app/programs", label: "Open programs" };
    tone = "warning";
  } else if (r && ["concluded"].includes(r.status)) {
    headline = "This year's review is complete.";
    detail = "Reports and any improvement plans are on each program's page.";
    action = { href: "/app/programs", label: "Programs" };
    tone = "success";
  } else {
    headline = `Everything is submitted. Visit ${fmtRange(r?.visit_start, r?.visit_end)}.`;
    detail = "Your reviewer may send a desk audit before the visit. It will appear on the program's page and here.";
    action = { href: "/app/lea/review", label: "Our review" };
    tone = "success";
  }

  const tasks: Task[] = [];
  if (windowOpen && !isTeacher) tasks.push({ key: "decl", title: "Confirm your declared programs", detail: `The window closes ${fmtDate(window!.closes_at.slice(0, 10))}.`, href: "/app/lea/declarations", action: "Declarations", tone: "warn" });
  for (const p of unsubmitted.slice(0, 6)) tasks.push({ key: p.id, title: `${p.program_catalog?.name ?? p.program_code}`, detail: isTeacher ? "Upload evidence for your program." : "Evidence and self-scores not yet submitted.", href: "/app/programs", action: "Open" });

  return (
    <>
      <PageHeader eyebrow={[lea?.system_code ? `System ${lea.system_code}` : null, year?.label].filter(Boolean).join(", ")} title={lea?.name ?? "Your system"} description="Where your system stands in this year's TAPE review, and what is due." />
      {denied}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Badge tone={tone === "warning" ? "warn" : tone === "success" ? "good" : "neutral"}>{summary ? (summary.released ? statusLabel(r?.status ?? summary.status) : "Scheduled") : "Not listed"}</Badge>
            <h2 className="mt-2 text-xl">{headline}</h2>
            <p className="mt-1 text-ink-muted">{detail}</p>
          </div>
          {action && <LinkButton href={action.href} variant="primary">{action.label}</LinkButton>}
        </div>
        {r && (
          <div className="mt-5 border-t border-line pt-4">
            <Facts items={[
              { label: "Review month", value: `${monthName(summary!.review_month)} ${summary!.review_year}` },
              { label: "Visit", value: fmtRange(r.visit_start, r.visit_end) },
              { label: "Evidence due", value: dueOn ? fmtDate(dueOn) : "Not set" },
              { label: "Programs selected", value: programs.length ? programs.map((p) => p.program_catalog?.name ?? p.program_code).join(", ") : "None" },
            ]} />
          </div>
        )}
      </Card>
      {tasks.length > 0 && (
        <Card title="To do" className="mt-6">
          <TaskList items={tasks} empty="Nothing is waiting on you." />
        </Card>
      )}
    </>
  );
}
