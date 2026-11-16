import type { Metadata } from "next";
import { addGrant, createInvitation, revokeGrant, revokeInvitation, setAccountStatus } from "@/lib/actions/admin";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { roleLabel } from "@/lib/components/shell";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Users" };

const here = "/app/admin/users";
const ROLES = ["state_admin", "cluster_admin", "reviewer", "leadership", "developer", "cte_director", "lea_staff", "teacher"] as const;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: profiles }, { data: invitations }, { data: leas }, { data: clusters }] = await Promise.all([
    supabase.from("profiles").select("id, email, display_name, status, role_grants:role_grants!role_grants_user_id_fkey(id, role, lea_id, cluster_code, revoked_at, leas(name))").order("display_name"),
    supabase.from("invitations").select("id, email, role, lea_id, cluster_code, accepted_at, revoked_at, expires_at, leas(name)").order("created_at", { ascending: false }).limit(100),
    supabase.from("leas").select("id, name, system_code").order("name"),
    supabase.from("clusters").select("code, name").order("sort"),
  ]);

  return (
    <>
      <PageHeader eyebrow="Administration" title="Users and invitations" description="Accounts exist only through invitations. Deactivating an account ends its access immediately." />
      <Notices {...notices} />
      <div className="grid gap-6">
        <Card title="Accounts">
          <Table caption="Accounts" head={<tr><th className={th}>Person</th><th className={th}>Roles</th><th className={th}>Status</th><th className={th}>Actions</th></tr>}>
            {(profiles ?? []).map((p) => {
              const grants = (p.role_grants as unknown as { id: string; role: string; lea_id: string | null; cluster_code: string | null; revoked_at: string | null; leas: { name: string } | null }[]).filter((g) => !g.revoked_at);
              return (
                <tr key={p.id}>
                  <td className={td}><div className="font-semibold">{p.display_name}</div><div className="text-ink-muted">{p.email}</div></td>
                  <td className={td}>
                    <ul className="space-y-1">
                      {grants.map((g) => (
                        <li key={g.id} className="flex flex-wrap items-center gap-2">
                          <Badge>{roleLabel(g.role)}</Badge>
                          <span className="text-ink-muted">{g.leas?.name ?? (g.cluster_code ? `Cluster ${g.cluster_code}` : "")}</span>
                          {p.id !== me.id && <form action={revokeGrant}><input type="hidden" name="id" value={g.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="ghost" className="min-h-8 px-2 text-xs">Remove</Button></form>}
                        </li>
                      ))}
                    </ul>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-brand">Add a role</summary>
                      <form action={addGrant} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="user_id" value={p.id} /><input type="hidden" name="return_to" value={here} />
                        <Select name="role" aria-label="Role" className="w-auto min-w-40">{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select>
                        <Select name="lea_id" aria-label="LEA (district roles)" className="w-auto min-w-40"><option value="">LEA (district roles)</option>{(leas ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
                        <Select name="cluster_code" aria-label="Cluster (cluster administrators)" className="w-auto min-w-40"><option value="">Cluster (cluster admins)</option>{(clusters ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
                        <Button type="submit" variant="secondary" className="min-h-9">Add</Button>
                      </form>
                    </details>
                  </td>
                  <td className={td}><Badge tone={p.status === "active" ? "good" : "bad"}>{p.status}</Badge></td>
                  <td className={td}>
                    {p.id !== me.id && (
                      <form action={setAccountStatus}>
                        <input type="hidden" name="user_id" value={p.id} /><input type="hidden" name="return_to" value={here} /><input type="hidden" name="status" value={p.status === "active" ? "deactivated" : "active"} />
                        <Button type="submit" variant={p.status === "active" ? "danger" : "secondary"} className="min-h-9 px-3 text-xs">{p.status === "active" ? "Deactivate" : "Reactivate"}</Button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card title="Invite someone">
            <form action={createInvitation} className="grid gap-3">
              <input type="hidden" name="return_to" value={here} /><input type="hidden" name="teacher_id" value="" />
              <Field id="i_email" label="Email" hint="The domain must be approved: an ALSDE staff domain for state roles, or the LEA's domain for district roles."><Input id="i_email" name="email" type="email" required /></Field>
              <Field id="i_name" label="Name (optional)"><Input id="i_name" name="display_name" /></Field>
              <Field id="i_role" label="Role"><Select id="i_role" name="role">{ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}</Select></Field>
              <Field id="i_lea" label="LEA (district roles only)"><Select id="i_lea" name="lea_id"><option value="">None</option>{(leas ?? []).map((l) => <option key={l.id} value={l.id}>{l.system_code} {l.name}</option>)}</Select></Field>
              <Field id="i_cluster" label="Cluster (cluster administrators only)"><Select id="i_cluster" name="cluster_code"><option value="">None</option>{(clusters ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select></Field>
              <Button type="submit">Create invitation</Button>
            </form>
          </Card>
          <Card title="Recent invitations">
            <ul className="divide-y divide-line text-sm">
              {(invitations ?? []).map((inv) => {
                const state = inv.accepted_at ? "Accepted" : inv.revoked_at ? "Revoked" : new Date(inv.expires_at) < new Date() ? "Expired" : "Open";
                return (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>{inv.email} <Badge>{roleLabel(inv.role)}</Badge> <span className="text-ink-muted">{(inv.leas as unknown as { name: string } | null)?.name ?? ""}</span> <Badge tone={state === "Open" ? "warn" : state === "Accepted" ? "good" : "neutral"}>{state}</Badge></span>
                    {state === "Open" && <form action={revokeInvitation}><input type="hidden" name="id" value={inv.id} /><input type="hidden" name="return_to" value={here} /><Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Revoke</Button></form>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
