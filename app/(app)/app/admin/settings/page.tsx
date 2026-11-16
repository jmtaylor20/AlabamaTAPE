import type { Metadata } from "next";
import { endPairing, saveDomain, saveHoliday, savePairing, saveSchoolYear, setDomainActive } from "@/lib/actions/admin";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select } from "@/lib/ui";

export const metadata: Metadata = { title: "Settings" };
const here = "/app/admin/settings";

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: years }, { data: holidays }, { data: domains }, { data: pairings }, { data: staff }] = await Promise.all([
    supabase.from("school_years").select("*").order("label", { ascending: false }),
    supabase.from("holidays").select("*").order("holiday_on"),
    supabase.from("approved_domains").select("*").is("lea_id", null).order("domain"),
    supabase.from("staff_pairings").select("id, reason, starts_on, ends_on, a:profiles!staff_pairings_person_a_fkey(display_name), b:profiles!staff_pairings_person_b_fkey(display_name)").order("starts_on", { ascending: false }),
    supabase.from("profiles").select("id, display_name").eq("status", "active").order("display_name"),
  ]);

  return (
    <>
      <PageHeader eyebrow="Administration" title="Settings" description="School years, the holiday calendar, ALSDE staff sign-in domains, and standing staff pairings." />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="School years">
          <ul className="divide-y divide-line text-sm">
            {(years ?? []).map((y) => <li key={y.id} className="flex items-center gap-3 py-2"><span className="font-semibold">{y.label}</span><span className="text-ink-muted">{y.starts_on} to {y.ends_on}</span>{y.is_current && <Badge tone="good">Current</Badge>}</li>)}
          </ul>
          <form action={saveSchoolYear} className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field id="y_label" label="Label" hint="Example: 2027-2028"><Input id="y_label" name="label" pattern="[0-9]{4}-[0-9]{4}" required /></Field>
            <Field id="y_start" label="Starts"><Input id="y_start" name="starts_on" type="date" required /></Field>
            <Field id="y_end" label="Ends"><Input id="y_end" name="ends_on" type="date" required /></Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="is_current" className="h-5 w-5" /> Make this the current year</label>
            <div><Button type="submit" variant="secondary">Save year</Button></div>
          </form>
        </Card>

        <Card title="ALSDE staff sign-in domains">
          {(domains ?? []).length === 0 ? <Empty>No staff domains. State roles cannot sign in until one is approved.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {(domains ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono">{d.domain} {!d.active && <Badge tone="bad">Disabled</Badge>}</span>
                  <form action={setDomainActive}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="active" value={d.active ? "false" : "true"} /><Button type="submit" variant={d.active ? "danger" : "secondary"} className="min-h-9 px-3 text-xs">{d.active ? "Disable" : "Enable"}</Button></form>
                </li>
              ))}
            </ul>
          )}
          <form action={saveDomain} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="lea_id" value="" /><input type="hidden" name="return_to" value={here} />
            <div className="min-w-56 flex-1"><Field id="s_domain" label="Add a staff domain"><Input id="s_domain" name="domain" required /></Field></div>
            <Button type="submit" variant="secondary">Approve</Button>
          </form>
        </Card>

        <Card title="Holiday calendar" >
          <ul className="max-h-72 divide-y divide-line overflow-y-auto text-sm">
            {(holidays ?? []).map((h) => <li key={h.id} className="flex gap-3 py-2"><span className="font-mono">{h.holiday_on}</span><span>{h.name}</span><Badge>{h.scope}</Badge></li>)}
          </ul>
          <form action={saveHoliday} className="mt-4 grid gap-3 sm:grid-cols-3">
            <Field id="h_date" label="Date"><Input id="h_date" name="holiday_on" type="date" required /></Field>
            <Field id="h_name" label="Name"><Input id="h_name" name="name" required /></Field>
            <Field id="h_scope" label="Scope"><Select id="h_scope" name="scope" defaultValue="state"><option value="state">State</option><option value="federal">Federal</option></Select></Field>
            <div className="sm:col-span-3"><Button type="submit" variant="secondary">Save holiday</Button></div>
          </form>
        </Card>

        <Card title="Staff pairings">
          <p className="mb-3 text-sm text-ink-muted">Wherever person A is included on a review or an email, person B is included too, for the dates below.</p>
          <ul className="divide-y divide-line text-sm">
            {(pairings ?? []).map((pr) => {
              const a = pr.a as unknown as { display_name: string } | null;
              const b = pr.b as unknown as { display_name: string } | null;
              const active = !pr.ends_on || pr.ends_on >= new Date().toISOString().slice(0, 10);
              return (
                <li key={pr.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{a?.display_name} includes {b?.display_name} <span className="text-ink-muted">({pr.reason}; from {pr.starts_on}{pr.ends_on ? ` to ${pr.ends_on}` : ""})</span></span>
                  {active && <form action={endPairing}><input type="hidden" name="id" value={pr.id} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">End</Button></form>}
                </li>
              );
            })}
          </ul>
          <form action={savePairing} className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field id="pa" label="Person A"><Select id="pa" name="person_a" required>{(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</Select></Field>
            <Field id="pb" label="Always include person B"><Select id="pb" name="person_b" required>{(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}</Select></Field>
            <Field id="preason" label="Reason"><Input id="preason" name="reason" required /></Field>
            <Field id="pend" label="Ends on (optional)"><Input id="pend" name="ends_on" type="date" /></Field>
            <div className="sm:col-span-2"><Button type="submit" variant="secondary">Save pairing</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
