import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";

const KIND: Record<string, string> = { check_in: "TAPE check-in", notification: "TAPE notification", evidence_due: "TAPE evidence due", visit_start: "TAPE visit begins", visit_end: "TAPE visit ends", ten_day_close: "TAPE ten-day close", pip_start: "TAPE PIP starts", pip_due: "TAPE PIP due" };
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

/** Personal calendar feed. Same policy filtering as the page: a district account never sees an unreleased review's dates. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") return NextResponse.redirect(new URL("/sign-in", req.url));
  const supabase = await createUserClient();
  const { data: items } = await supabase.from("calendar_items").select("*").order("on_date");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TAPE Online//Milestones//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:TAPE milestones"];
  for (const i of items ?? []) {
    const d = i.on_date.replaceAll("-", "");
    lines.push("BEGIN:VEVENT", `UID:${i.id}@tape-online`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc(`${KIND[i.kind] ?? i.kind}: ${i.lea_name}`)}`, `DESCRIPTION:${esc(`${i.lea_name}, ${i.review_month}/${i.review_year} review${i.done ? " (done)" : ""}`)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new NextResponse(lines.join("\r\n") + "\r\n", { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="tape-milestones.ics"', "Cache-Control": "no-store" } });
}
