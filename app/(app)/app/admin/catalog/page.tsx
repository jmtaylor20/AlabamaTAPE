import type { Metadata } from "next";
import { saveCluster, saveProgram } from "@/lib/actions/admin";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table, td, th, Disclosure } from "@/lib/ui";

export const metadata: Metadata = { title: "Programs" };

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const [{ data: clusters }, { data: programs }] = await Promise.all([
    supabase.from("clusters").select("*").order("sort"),
    supabase.from("program_catalog").select("*, clusters(name)").order("code"),
  ]);

  return (
    <>
      <PageHeader eyebrow="Administration" title="Program catalog" description="Clusters and program codes as declared by systems. Each program belongs to exactly one cluster." />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card title="Clusters">
          <ul className="divide-y divide-line text-sm">
            {(clusters ?? []).map((c) => <li key={c.code} className="flex gap-3 py-2"><span className="font-mono">{c.code}</span><span>{c.name}</span></li>)}
          </ul>
          <Disclosure label="Add or update a cluster" className="mt-4">
            <form action={saveCluster} className="flex flex-col gap-3">
              <Field id="c_code" label="Cluster code" hint="Two digits."><Input id="c_code" name="code" pattern="[0-9]{2}" required /></Field>
              <Field id="c_name" label="Name"><Input id="c_name" name="name" required /></Field>
              <Button type="submit" variant="secondary">Save cluster</Button>
            </form>
          </Disclosure>
        </Card>
        <Card title="Programs">
          <Table caption="Programs" head={<tr><th className={th}>Code</th><th className={th}>Program</th><th className={th}>Cluster</th><th className={th}>Level</th><th className={th}>Flags</th></tr>}>
            {(programs ?? []).map((p) => (
              <tr key={p.code}>
                <td className={`${td} font-mono`}>{p.code}</td><td className={td}>{p.name}</td><td className={td}>{(p.clusters as unknown as { name: string } | null)?.name}</td><td className={td}>{p.level}</td>
                <td className={td}>{p.is_coop && <Badge>Cooperative Education</Badge>} {!p.active && <Badge tone="bad">Inactive</Badge>}</td>
              </tr>
            ))}
          </Table>
          <Disclosure label="Add or update a program" className="mt-4">
            <form action={saveProgram} className="grid gap-3 sm:grid-cols-3">
              <Field id="p_code" label="Program code"><Input id="p_code" name="code" pattern="[0-9]{1,3}" required /></Field>
              <Field id="p_name" label="Name"><Input id="p_name" name="name" required /></Field>
              <Field id="p_cluster" label="Cluster">
                <Select id="p_cluster" name="cluster_code" required>{(clusters ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</Select>
              </Field>
              <Field id="p_level" label="Level"><Select id="p_level" name="level" defaultValue="secondary"><option value="secondary">Secondary</option><option value="middle">Middle school</option></Select></Field>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="is_coop" className="h-5 w-5" /> Cooperative Education (scored on 5.2.A only)</label>
              <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="active" defaultChecked className="h-5 w-5" /> Active</label>
              <div className="sm:col-span-3"><Button type="submit" variant="secondary">Save program</Button></div>
            </form>
          </Disclosure>
        </Card>
      </div>
    </>
  );
}
