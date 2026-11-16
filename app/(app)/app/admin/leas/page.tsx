import type { Metadata } from "next";
import Link from "next/link";
import { saveLea } from "@/lib/actions/admin";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { createUserClient } from "@/lib/supabase/server";
import { Badge, Button, Card, Field, Input, PageHeader, Select, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "LEAs" };

export default async function LeasPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: leas } = await supabase.from("leas").select("id, system_code, name, lea_type, active, schools(count), teachers(count)").order("system_code");

  return (
    <>
      <PageHeader eyebrow="Administration" title="Local education agencies" description="Every system, its schools, its teachers, and the email domains its people may sign in with." />
      <Notices {...notices} />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Table caption="Local education agencies" head={<tr><th className={th}>Code</th><th className={th}>System</th><th className={th}>Type</th><th className={th}>Schools</th><th className={th}>Teachers</th><th className={th}>Status</th></tr>}>
          {(leas ?? []).map((lea) => (
            <tr key={lea.id}>
              <td className={`${td} font-mono`}>{lea.system_code}</td>
              <td className={td}><Link href={`/app/admin/leas/${lea.id}`} className="font-semibold text-brand underline">{lea.name}</Link></td>
              <td className={td}>{lea.lea_type}</td>
              <td className={`${td} tabular-nums`}>{(lea.schools as unknown as { count: number }[])[0]?.count ?? 0}</td>
              <td className={`${td} tabular-nums`}>{(lea.teachers as unknown as { count: number }[])[0]?.count ?? 0}</td>
              <td className={td}><Badge tone={lea.active ? "good" : "bad"}>{lea.active ? "Active" : "Inactive"}</Badge></td>
            </tr>
          ))}
        </Table>
        <Card title="Add a system">
          <form action={saveLea} className="flex flex-col gap-3">
            <Field id="system_code" label="System code" hint="Three digits, as in ALSDE records."><Input id="system_code" name="system_code" inputMode="numeric" pattern="[0-9]{3}" required /></Field>
            <Field id="name" label="Name"><Input id="name" name="name" required /></Field>
            <Field id="lea_type" label="Type">
              <Select id="lea_type" name="lea_type" defaultValue="county">
                <option value="county">County</option><option value="city">City</option><option value="charter">Charter</option><option value="college">Community college</option><option value="other">Other</option>
              </Select>
            </Field>
            <input type="hidden" name="active" value="true" />
            <Button type="submit">Add system</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
