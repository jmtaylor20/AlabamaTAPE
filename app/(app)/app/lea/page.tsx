import type { Metadata } from "next";
import { createInvitation, revokeGrant, revokeInvitation, saveSchool, saveTeacher } from "@/lib/actions/admin";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { roleLabel } from "@/lib/components/shell";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, td, th, Disclosure } from "@/lib/ui";

export const metadata: Metadata = { title: "My LEA" };
const here = "/app/lea";

/** The Director's and LEA staff's view of their own system. Teachers see only their own record. */
export default async function LeaHomePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const leaId = user.leaIds[0];
  if (!leaId) return <Alert tone="warning">Your account is not attached to a system.</Alert>;

  const isDirector = user.grants.some((g) => g.role === "cte_director" && g.lea_id === leaId);
  const manages = isDirector || user.grants.some((g) => g.role === "lea_staff" && g.lea_id === leaId);

  const [{ data: lea }, { data: schools }, { data: teachers }, { data: domains }, { data: invitations }, { data: grants }, { data: year }] = await Promise.all([
    supabase.from("leas").select("*").eq("id", leaId).maybeSingle(),
    supabase.from("schools").select("*").eq("lea_id", leaId).order("school_code"),
    supabase.from("teachers").select("id, display_name, email, status, alsde_teacher_id, profile_id, teacher_years(contract_type, first_year, school_years(is_current))").eq("lea_id", leaId).order("display_name"),
    supabase.from("approved_domains").select("domain").eq("lea_id", leaId).eq("active", true),
    supabase.from("invitations").select("id, email, role, accepted_at, revoked_at, expires_at").eq("lea_id", leaId).order("created_at", { ascending: false }),
    supabase.from("role_grants").select("id, role, user_id, profiles!role_grants_user_id_fkey(display_name, email, status)").eq("lea_id", leaId).is("revoked_at", null),
    supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle(),
  ]);
  if (!lea) return <Alert tone="warning">Your system record could not be loaded.</Alert>;

  return (
    <>
      <PageHeader eyebrow={`System ${lea.system_code}`} title={lea.name} description={manages ? "Your schools, teachers, and the people who can sign in for your system." : "Your teacher record."} />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Teachers" className={manages ? "lg:col-span-2" : ""}>
          {(teachers ?? []).length === 0 ? <Empty>No teachers on file yet.</Empty> : (
            <Table caption="Teachers" head={<tr><th className={th}>Name</th><th className={th}>Email</th><th className={th}>{year?.label ?? "Current"} contract</th><th className={th}>Account</th><th className={th}>Status</th></tr>}>
              {(teachers ?? []).map((t) => {
                const ty = (t.teacher_years as unknown as { contract_type: string; first_year: boolean; school_years: { is_current: boolean } | null }[]).find((y) => y.school_years?.is_current);
                return (
                  <tr key={t.id}>
                    <td className={td}>{t.display_name}</td><td className={td}>{t.email ?? ""}</td>
                    <td className={td}>{ty ? `${ty.contract_type === "extended" ? "Extended" : "9 month"}${ty.first_year ? ", first year" : ""}` : "Not set"}</td>
                    <td className={td}>{t.profile_id ? <Badge tone="good">Has account</Badge> : <Badge>No account</Badge>}</td>
                    <td className={td}><Badge tone={t.status === "active" ? "good" : "bad"}>{t.status}</Badge></td>
                  </tr>
                );
              })}
            </Table>
          )}
          {manages && (
            <Disclosure label="Add a teacher" className="mt-4">
              <form action={saveTeacher} className="grid gap-3 sm:grid-cols-4">
                <input type="hidden" name="lea_id" value={leaId} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="status" value="active" />
                {year && <input type="hidden" name="school_year_id" value={year.id} />}
                <Field id="t_name" label="Teacher name"><Input id="t_name" name="display_name" required /></Field>
                <Field id="t_email" label="Email"><Input id="t_email" name="email" type="email" /></Field>
                <Field id="t_alsde" label="ALSDE teacher ID"><Input id="t_alsde" name="alsde_teacher_id" /></Field>
                <Field id="t_contract" label="Contract"><Select id="t_contract" name="contract_type" defaultValue="nine_month"><option value="nine_month">9 month</option><option value="extended">Extended (9.5 months or more)</option></Select></Field>
                <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="first_year" className="h-5 w-5" /> First-year teacher this school year</label>
                <div className="sm:col-span-4"><Button type="submit" variant="secondary">Add teacher</Button></div>
              </form>
            </Disclosure>
          )}
        </Card>

        {manages && (
          <Card title="Schools">
            <ul className="divide-y divide-line text-sm">
              {(schools ?? []).map((s) => <li key={s.id} className="flex gap-3 py-2"><span className="font-mono">{s.school_code}</span><span>{s.name}</span><span className="text-ink-muted">{s.school_type.replaceAll("_", " ")}</span></li>)}
            </ul>
            <p className="mt-3 text-sm text-ink-muted">To add or rename a school, contact the TAPE coordinator. You can correct a school&apos;s type or status below.</p>
            {(schools ?? []).map((s) => (
              <details key={s.id} className="mt-2 text-sm">
                <summary className="cursor-pointer font-semibold text-brand">Edit {s.name}</summary>
                <form action={saveSchool} className="mt-2 grid gap-3 sm:grid-cols-3">
                  <input type="hidden" name="id" value={s.id} /><input type="hidden" name="lea_id" value={leaId} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="school_code" value={s.school_code} /><input type="hidden" name="name" value={s.name} />
                  <Field id={`type-${s.id}`} label="Type"><Select id={`type-${s.id}`} name="school_type" defaultValue={s.school_type}><option value="high_school">High school</option><option value="middle_school">Middle school</option><option value="career_tech_center">Career tech center</option><option value="college">College</option><option value="other">Other</option></Select></Field>
                  <Field id={`active-${s.id}`} label="Status"><Select id={`active-${s.id}`} name="active" defaultValue={s.active ? "true" : ""}><option value="true">Active</option><option value="">Inactive</option></Select></Field>
                  <div className="self-end"><Button type="submit" variant="secondary">Save</Button></div>
                </form>
              </details>
            ))}
          </Card>
        )}

        {manages && (
          <Card title="People who can sign in">
            <ul className="divide-y divide-line text-sm">
              {(grants ?? []).map((g) => {
                const p = g.profiles as unknown as { display_name: string; email: string; status: string } | null;
                const removable = isDirector && g.user_id !== user.id && (g.role === "teacher" || g.role === "lea_staff");
                return (
                  <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{p?.display_name} <span className="text-ink-muted">({p?.email})</span> <Badge>{roleLabel(g.role)}</Badge></span>
                    {removable && <form action={revokeGrant}><input type="hidden" name="id" value={g.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Remove</Button></form>}
                  </li>
                );
              })}
            </ul>
            {isDirector ? (
              <>
                <h3 className="mt-5 text-sm font-semibold">Invite a teacher or staff member</h3>
                <p className="text-sm text-ink-muted">Approved domains for your system: {(domains ?? []).map((d) => d.domain).join(", ") || "none yet"}.</p>
                <Disclosure label="Invite a teacher or staff member" className="mt-4">
                  <form action={createInvitation} className="grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="lea_id" value={leaId} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="cluster_code" value="" />
                    <Field id="inv_email" label="Email"><Input id="inv_email" name="email" type="email" required /></Field>
                    <Field id="inv_name" label="Name (optional)"><Input id="inv_name" name="display_name" /></Field>
                    <Field id="inv_role" label="Role"><Select id="inv_role" name="role" defaultValue="teacher"><option value="teacher">Teacher (uploads evidence for their own programs)</option><option value="lea_staff">LEA Staff (same view as you, cannot submit scores)</option></Select></Field>
                    <Field id="inv_teacher" label="Link to teacher record (teachers only)"><Select id="inv_teacher" name="teacher_id"><option value="">None</option>{(teachers ?? []).filter((t) => !t.profile_id).map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select></Field>
                    <div className="sm:col-span-2"><Button type="submit" variant="secondary">Create invitation</Button></div>
                  </form>
                </Disclosure>
                <ul className="mt-4 divide-y divide-line text-sm">
                  {(invitations ?? []).filter((i) => !i.accepted_at).map((inv) => {
                    const state = inv.revoked_at ? "Revoked" : new Date(inv.expires_at) < new Date() ? "Expired" : "Open";
                    return (
                      <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                        <span>{inv.email} <Badge>{roleLabel(inv.role)}</Badge> <Badge tone={state === "Open" ? "warn" : "neutral"}>{state}</Badge></span>
                        {state === "Open" && <form action={revokeInvitation}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Revoke</Button></form>}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="mt-4 text-sm text-ink-muted">Only the CTE Director can invite people.</p>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
