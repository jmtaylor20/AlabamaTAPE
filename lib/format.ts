/** Date and label helpers shared by pages. Plain words, no dashes between ranges. */

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthName(m: number | null | undefined) {
  return m ? MONTHS[m - 1] ?? "" : "";
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return "";
  const [y, m, day] = d.slice(0, 10).split("-");
  if (!y || !m || !day) return d;
  return `${monthName(Number(m)).slice(0, 3)} ${Number(day)}, ${y}`;
}

export function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

export function fmtRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return "Not set";
  if (!end || end === start) return fmtDate(start);
  return `${fmtDate(start)} to ${fmtDate(end)}`;
}

export function statusLabel(s: string | null | undefined) {
  return (s ?? "").replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
}

export type DeclaredLike = { status: string; excluded_reason: string | null; vacant: boolean; first_year_teacher: boolean; location_lea_id: string | null; lea_id: string; delivery_type: string; dual_scenario: number | null };

/** Mirrors app.declared_program_eligible so pages can explain why a program is out of the pool. */
export function eligibilityReason(d: DeclaredLike, catalogActive = true): string | null {
  if (d.status !== "active") return "Removed";
  if (!catalogActive) return "Program retired";
  if (d.excluded_reason) return d.excluded_reason;
  if (d.vacant) return "Vacant";
  if (d.first_year_teacher) return "First-year teacher";
  if (d.location_lea_id && d.location_lea_id !== d.lea_id) return "Taught at another system";
  if (d.delivery_type === "ACCESS") return "ACCESS delivery";
  if (d.delivery_type === "DUAL" && !(d.dual_scenario && d.dual_scenario <= 3)) return `Dual enrollment scenario ${d.dual_scenario ?? "unknown"}`;
  return null;
}

/** True while a declaration window is still accepting changes. Server pages evaluate this once per request. */
export function windowOpen(w: { closes_at: string; confirmed_at: string | null; closed_early_at: string | null } | null | undefined) {
  return !!w && !w.confirmed_at && !w.closed_early_at && new Date(w.closes_at).getTime() > Date.now();
}
