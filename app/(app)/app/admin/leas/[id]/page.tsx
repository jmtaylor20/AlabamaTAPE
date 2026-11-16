import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createInvitation, revokeGrant, revokeInvitation, saveDomain, saveLea, saveSchool, saveTeacher, setDomainActive } from "@/lib/actions/admin";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { roleLabel } from "@/lib/components/shell";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "LEA" };

export default async function LeaDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requireRole("state_admin");
  const { id } = await params;
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const here = `/app/admin/leas/${id}`;

  const [{ data: lea }, { data: schools }, { data: teachers }, { data: domains }, { data: invitations }, { data: grants }, { data: year }] = await Promise.all([
    supabase.from("leas").select("*").eq("id", id).maybeSingle(),
    supabase.from("schools").select("*").eq("lea_id", id).order("school_code"),
    supabase.from("teachers").select("id, display_name, email, status, alsde_teacher_id, profile_id, teacher_years(contract_type, first_year, school_years(label, is_current))").eq("lea_id", id).order("display_name"),
    supabase.from("approved_domains").select("*").eq("lea_id", id).order("domain"),
    supabase.from("invitations").select("id, email, role, accepted_at, revoked_at, expires_at").eq("lea_id", id).order("created_at", { ascending: false }),
    supabase.from("role_grants").select("id, role, revoked_at, profiles!role_grants_user_id_fkey(display_name, email, status)").eq("lea_id", id).is("revoked_at", null),
    supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle(),
  ]);
  if (!lea) notFound();

  return (
    <>
      <PageHeader eyebrow={`System ${lea.system_code}`} title={lea.name} description="Schools, teachers, approved sign-in domains, seats, and invitations for this system." />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="System details">
          <form action={saveLea} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={lea.id} />
            <Field id="system_code" label="System code"><Input id="system_code" name="system_code" defaultValue={lea.system_code} pattern="[0-9]{3}" required /></Field>
            <Field id="name" label="Name"><Input id="name" name="name" defaultValue={lea.name} required /></Field>
            <Field id="lea_type" label="Type">
              <Select id="lea_type" name="lea_type" defaultValue={lea.lea_type}>
                <option value="county">County</option><option value="city">City</option><option value="charter">Charter</option><option value="college">Community college</option><option value="other">Other</option>
              </Select>
            </Field>
            <Field id="active" label="Status">
              <Select id="active" name="active" defaultValue={lea.active ? "true" : ""}><option value="true">Active</option><option value="">Inactive</option></Select>
            </Field>
            <div className="sm:col-span-2"><Button type="submit">Save</Button></div>
          </form>
        </Card>

        <Card title="Approved sign-in domains">
          {(domains ?? []).length === 0 ? <Empty>No domains yet. Directors and teachers cannot sign in until one is approved.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {(domains ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-mono">{d.domain}</span>
                  <form action={setDomainActive}>
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="active" value={d.active ? "false" : "true"} />
                    <Button type="submit" variant={d.active ? "danger" : "secondary"} className="min-h-9 px-3 text-xs">{d.active ? "Disable" : "Enable"}</Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={saveDomain} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="lea_id" value={lea.id} /><input type="hidden" name="return_to" value={here} />
            <div className="min-w-56 flex-1"><Field id="domain" label="Add a domain" hint="Example: lcschools.org"><Input id="domain" name="domain" required /></Field></div>
            <Button type="submit" variant="secondary">Approve</Button>
          </form>
        </Card>

        <Card title="Schools">
          <Table caption="Schools" head={<tr><th className={th}>Code</th><th className={th}>School</th><th className={th}>Type</th><th className={th}>Status</th></tr>}>
            {(schools ?? []).map((s) => (
              <tr key={s.id}><td className={`${td} font-mono`}>{s.school_code}</td><td className={td}>{s.name}</td><td className={td}>{s.school_type.replaceAll("_", " ")}</td><td className={td}><Badge tone={s.active ? "good" : "bad"}>{s.active ? "Active" : "Inactive"}</Badge></td></tr>
            ))}
          </Table>
          <form action={saveSchool} className="mt-4 grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="lea_id" value={lea.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="active" value="true" />
            <Field id="school_code" label="School code"><Input id="school_code" name="school_code" pattern="[0-9]{4}" required /></Field>
            <Field id="school_name" label="Name"><Input id="school_name" name="name" required /></Field>
            <Field id="school_type" label="Type">
              <Select id="school_type" name="school_type" defaultValue="high_school">
                <option value="high_school">High school</option><option value="middle_school">Middle school</option><option value="career_tech_center">Career tech center</option><option value="college">College</option><option value="other">Other</option>
              </Select>
            </Field>
            <div className="sm:col-span-3"><Button type="submit" variant="secondary">Add school</Button></div>
          </form>
        </Card>

        <Card title="Seats and invitations">
          <h3 className="text-sm font-semibold">Active seats</h3>
          {(grants ?? []).length === 0 ? <Empty>No one from this system has an account yet.</Empty> : (
            <ul className="mt-2 divide-y divide-line text-sm">
              {(grants ?? []).map((g) => {
                const p = g.profiles as unknown as { display_name: string; email: string; status: string } | null;
                return (
                  <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                    <span>{p?.display_name} <span className="text-ink-muted">({p?.email})</span> <Badge>{roleLabel(g.role)}</Badge> {p?.status === "deactivated" && <Badge tone="bad">Deactivated</Badge>}</span>
                    <form action={revokeGrant}><input type="hidden" name="id" value={g.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Remove seat</Button></form>
                  </li>
                );
              })}
            </ul>
          )}
          <h3 className="mt-5 text-sm font-semibold">Invitations</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {(invitations ?? []).map((inv) => {
              const state = inv.accepted_at ? "Accepted" : inv.revoked_at ? "Revoked" : new Date(inv.expires_at) < new Date() ? "Expired" : "Open";
              return (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                  <span>{inv.email} <Badge>{roleLabel(inv.role)}</Badge> <Badge tone={state === "Open" ? "warn" : state === "Accepted" ? "good" : "neutral"}>{state}</Badge></span>
                  {state === "Open" && <form action={revokeInvitation}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Revoke</Button></form>}
                </li>
              );
            })}
          </ul>
          <form action={createInvitation} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="lea_id" value={lea.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="cluster_code" value="" /><input type="hidden" name="teacher_id" value="" />
            <Field id="inv_email" label="Invite by email" hint="Must use an approved domain above."><Input id="inv_email" name="email" type="email" required /></Field>
            <Field id="inv_name" label="Name (optional)"><Input id="inv_name" name="display_name" /></Field>
            <Field id="inv_role" label="Role">
              <Select id="inv_role" name="role" defaultValue="cte_director"><option value="cte_director">CTE Director</option><option value="lea_staff">LEA Staff</option><option value="teacher">Teacher</option></Select>
            </Field>
            <div className="self-end"><Button type="submit" variant="secondary">Create invitation</Button></div>
          </form>
        </Card>

        <Card title="Teachers" className="lg:col-span-2">
          <Table caption="Teachers" head={<tr><th className={th}>Name</th><th className={th}>Email</th><th className={th}>ALSDE ID</th><th className={th}>{year?.label ?? "Current year"} contract</th><th className={th}>Account</th><th className={th}>Status</th></tr>}>
            {(teachers ?? []).map((t) => {
              const ty = (t.teacher_years as unknown as { contract_type: string; first_year: boolean; school_years: { is_current: boolean } | null }[]).find((y) => y.school_years?.is_current);
              return (
                <tr key={t.id}>
                  <td className={td}>{t.display_name}</td><td className={td}>{t.email ?? ""}</td><td className={`${td} font-mono`}>{t.alsde_teacher_id ?? ""}</td>
                  <td className={td}>{ty ? `${ty.contract_type === "extended" ? "Extended" : "9 month"}${ty.first_year ? ", first year" : ""}` : "Not set"}</td>
                  <td className={td}>{t.profile_id ? <Badge tone="good">Has account</Badge> : <Badge>No account</Badge>}</td>
                  <td className={td}><Badge tone={t.status === "active" ? "good" : "bad"}>{t.status}</Badge></td>
                </tr>
              );
            })}
          </Table>
          <form action={saveTeacher} className="mt-4 grid gap-3 sm:grid-cols-4">
            <input type="hidden" name="lea_id" value={lea.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="status" value="active" />
            {year && <input type="hidden" name="school_year_id" value={year.id} />}
            <Field id="t_name" label="Teacher name"><Input id="t_name" name="display_name" required /></Field>
            <Field id="t_email" label="Email"><Input id="t_email" name="email" type="email" /></Field>
            <Field id="t_alsde" label="ALSDE teacher ID"><Input id="t_alsde" name="alsde_teacher_id" /></Field>
            <Field id="t_contract" label="Contract">
              <Select id="t_contract" name="contract_type" defaultValue="nine_month"><option value="nine_month">9 month</option><option value="extended">Extended (9.5 months or more)</option></Select>
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="first_year" className="h-5 w-5" /> First-year teacher this school year</label>
            <div className="sm:col-span-4"><Button type="submit" variant="secondary">Add teacher</Button></div>
          </form>
        </Card>
      </div>
    </>
  );
}
