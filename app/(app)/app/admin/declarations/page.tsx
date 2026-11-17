import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime, windowOpen } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Empty, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Declarations" };

/** Which systems have declared programs on file for the current year, and whose review window is open. */
export default async function DeclarationsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("state_admin");
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: year } = await supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle();
  if (!year) return <Alert tone="warning">Set a current school year in Settings first.</Alert>;
  const [{ data: leas }, { data: declared }, { data: windows }] = await Promise.all([
    supabase.from("leas").select("id, system_code, name, active, code_is_placeholder").order("name"),
    supabase.from("declared_programs").select("lea_id, status").eq("school_year_id", year.id),
    supabase.from("declaration_windows").select("lea_id, closes_at, confirmed_at, closed_early_at, opens_at").eq("school_year_id", year.id).order("opens_at", { ascending: false }),
  ]);
  const counts = new Map<string, number>();
  for (const d of declared ?? []) if (d.status === "active") counts.set(d.lea_id, (counts.get(d.lea_id) ?? 0) + 1);
  const latest = new Map<string, { closes_at: string; confirmed_at: string | null; closed_early_at: string | null }>();
  for (const w of windows ?? []) if (!latest.has(w.lea_id)) latest.set(w.lea_id, w);

  return (
    <>
      <PageHeader eyebrow={year.label} title="Program declarations" description="Programs each system declared through PowerSchool. Import a system's spreadsheet, then open its one-time review window so the Director can confirm or correct the list. Every change is tracked." />
      <Notices {...notices} />
      {(leas ?? []).length === 0 ? <Empty>No systems yet.</Empty> : (
        <Table caption="Systems and their declarations" head={<tr><th className={th}>Code</th><th className={th}>System</th><th className={th}>Declared programs</th><th className={th}>Review window</th></tr>}>
          {(leas ?? []).filter((l) => l.active).map((l) => {
            const w = latest.get(l.id);
            const open = windowOpen(w);
            return (
              <tr key={l.id}>
                <td className={`${td} font-mono`}>{l.code_is_placeholder ? "pending" : l.system_code}</td>
                <td className={td}><Link href={`/app/admin/declarations/${l.id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2">{l.name}</Link></td>
                <td className={`${td} tabular-nums`}>{counts.get(l.id) ?? 0}</td>
                <td className={td}>{!w ? <Badge>Not opened</Badge> : w.confirmed_at ? <Badge tone="good">Confirmed {fmtDateTime(w.confirmed_at)}</Badge> : open ? <Badge tone="warn">Open until {fmtDateTime(w.closes_at)}</Badge> : <Badge>Closed</Badge>}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
