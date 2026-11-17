import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";
import { roleLabel } from "@/lib/components/shell";
import { Card, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await createUserClient();
  const { data: events } = await supabase.from("audit_events").select("occurred_at, action, entity_type").eq("actor_id", user.id).order("occurred_at", { ascending: false }).limit(20);

  return (
    <>
      <PageHeader title="Your account" description={user.email} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Roles">
          {user.grants.length === 0 ? <p className="text-sm text-ink-muted">No active roles.</p> : (
            <ul className="space-y-1 text-sm">
              {user.grants.map((g) => (
                <li key={g.id}>{roleLabel(g.role)}{g.cluster_code ? ` (cluster ${g.cluster_code})` : ""}</li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-sm text-ink-muted">Multi-factor authentication is on for every account and cannot be turned off. To move to a new phone, ask the TAPE coordinator to reset your authenticator.</p>
        </Card>
        <Card title="Your recent activity">
          <Table caption="Your recent activity" head={<tr><th className={th}>When</th><th className={th}>Action</th><th className={th}>Record</th></tr>}>
            {(events ?? []).map((e, i) => (
              <tr key={i}><td className={td}>{new Date(e.occurred_at).toLocaleString("en-US")}</td><td className={td}>{e.action}</td><td className={td}>{e.entity_type}</td></tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
