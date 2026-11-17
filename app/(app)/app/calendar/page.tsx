import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { fmtDate, monthName, statusLabel } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Card, Empty, LinkButton, PageHeader } from "@/lib/ui";

export const metadata: Metadata = { title: "Calendar" };

const KIND: Record<string, string> = { check_in: "Check-in", notification: "Notification", evidence_due: "Evidence due", visit_start: "Visit begins", visit_end: "Visit ends", ten_day_close: "Ten-day close", pip_start: "PIP starts", pip_due: "PIP due" };

/** Milestones for every review the caller may see, by month. District roles see their own system only, and only after release. */
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const user = await requireUser();
  const { mine } = await searchParams;
  const supabase = await createUserClient();
  const [{ data: items }, { data: myReviews }] = await Promise.all([
    supabase.from("calendar_items").select("*").order("on_date"),
    user.isStaff ? supabase.from("review_assignments").select("program_reviews(lea_review_id)").is("revoked_at", null).or(`user_id.eq.${user.id},email.eq.${user.email}`) : Promise.resolve({ data: [] as { program_reviews: unknown }[] }),
  ]);
  const myIds = new Set((myReviews ?? []).map((r) => (r.program_reviews as unknown as { lea_review_id: string } | null)?.lea_review_id).filter(Boolean));
  const rows = (items ?? []).filter((i) => !mine || myIds.has(i.lea_review_id));
  const byMonth = new Map<string, typeof rows>();
  for (const i of rows) { const k = i.on_date.slice(0, 7); byMonth.set(k, [...(byMonth.get(k) ?? []), i]); }

  return (
    <>
      <PageHeader eyebrow="Schedule" title="Milestone calendar" description="Check-ins, notifications, evidence due dates, visits, ten-day closes, and PIP dates for every review you can see."
        actions={<>{user.isStaff && <LinkButton href={mine ? "/app/calendar" : "/app/calendar?mine=1"}>{mine ? "Show all systems" : "Only my assignments"}</LinkButton>}<LinkButton href="/app/calendar.ics" variant="primary">Subscribe (ICS)</LinkButton></>} />
      {rows.length === 0 ? <Empty>Nothing scheduled.</Empty> : [...byMonth.entries()].map(([k, list]) => {
        const [y, m] = k.split("-");
        return (
          <Card key={k} title={`${monthName(Number(m))} ${y}`} className="mb-4">
            <ul className="divide-y divide-line text-sm">
              {list.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-28 tabular-nums">{fmtDate(i.on_date)}</span>
                  <Badge tone={i.done ? "good" : i.kind === "visit_start" || i.kind === "visit_end" ? "warn" : "neutral"}>{KIND[i.kind] ?? statusLabel(i.kind)}</Badge>
                  {user.isStaff ? <Link href={`/app/admin/reviews/${i.lea_review_id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">{i.lea_name}</Link> : <span className="font-semibold">{i.lea_name}</span>}
                  <span className="text-ink-muted">{monthName(i.review_month)} {i.review_year} review{!i.released && user.isStaff ? ", not yet released" : ""}</span>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      <p className="text-xs text-ink-muted">The ICS link is a personal feed of the same dates; add it to Outlook as an internet calendar. It shows only what your account may see.</p>
    </>
  );
}
