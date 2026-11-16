import type { Metadata } from "next";
import { requireRole } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";
import { Button, Field, Input, PageHeader, Select, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string }> }) {
  await requireRole("state_admin");
  const { q = "", entity = "" } = await searchParams;
  const supabase = await createUserClient();
  let query = supabase.from("audit_events").select("id, occurred_at, actor_id, actor_role, action, entity_type, entity_id, lea_id, meta").order("occurred_at", { ascending: false }).limit(200);
  if (entity) query = query.eq("entity_type", entity);
  if (q) query = query.ilike("action", `%${q.replaceAll("%", "")}%`);
  const [{ data: events }, { data: actors }] = await Promise.all([query, supabase.from("profiles").select("id, display_name")]);
  const names = new Map((actors ?? []).map((a) => [a.id, a.display_name]));

  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit log" description="Every sign-in, record change, and permission change. Rows can never be edited or removed." />
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48"><Field id="q" label="Action contains"><Input id="q" name="q" defaultValue={q} /></Field></div>
        <div className="min-w-48"><Field id="entity" label="Record type">
          <Select id="entity" name="entity" defaultValue={entity}>
            <option value="">All</option>
            {["profiles", "role_grants", "invitations", "leas", "schools", "teachers", "teacher_years", "approved_domains", "program_catalog", "clusters", "school_years", "holidays", "staff_pairings"].map((e) => <option key={e} value={e}>{e}</option>)}
          </Select>
        </Field></div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      <Table caption="Audit events" head={<tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Record</th><th className={th}>Details</th></tr>}>
        {(events ?? []).map((e) => (
          <tr key={e.id}>
            <td className={`${td} whitespace-nowrap`}>{new Date(e.occurred_at).toLocaleString("en-US")}</td>
            <td className={td}>{e.actor_id ? names.get(e.actor_id) ?? e.actor_id.slice(0, 8) : "system"}</td>
            <td className={`${td} font-mono text-xs`}>{e.action}</td>
            <td className={`${td} font-mono text-xs`}>{e.entity_type}{e.entity_id ? ` ${e.entity_id.slice(0, 8)}` : ""}</td>
            <td className={`${td} max-w-md truncate text-xs text-ink-muted`}>{e.meta ? JSON.stringify(e.meta) : ""}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
