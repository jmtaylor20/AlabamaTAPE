import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Empty, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Programs" };

/** Every declared program the signed-in person can see this year, with evidence and review status. The database filters the list. */
export default async function ProgramsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const notices = await readNotices(searchParams);
  const supabase = await createUserClient();
  const { data: year } = await supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle();
  if (!year) return <Alert tone="warning">No current school year is set.</Alert>;
  const [{ data: programs }, { data: files }, { data: forms }] = await Promise.all([
    supabase.from("declared_programs").select("id, lea_id, program_code, delivery_type, dual_scenario, status, leas!declared_programs_lea_id_fkey(name, system_code), program_catalog(name), home:schools!declared_programs_home_school_id_fkey(name, school_code), declared_program_teachers(teachers(display_name))").eq("school_year_id", year.id).eq("status", "active").order("program_code"),
    supabase.from("evidence_files").select("declared_program_id, scan_status").eq("school_year_id", year.id).is("removed_at", null),
    supabase.from("form_141").select("declared_program_id, status").eq("school_year_id", year.id),
  ]);
  const fileCount = new Map<string, number>();
  for (const f of files ?? []) if (f.scan_status === "clean") fileCount.set(f.declared_program_id, (fileCount.get(f.declared_program_id) ?? 0) + 1);
  const formStatus = new Map((forms ?? []).map((f) => [f.declared_program_id, f.status]));
  const rows = (programs ?? []).sort((a, b) => ((a.leas as unknown as { name: string })?.name ?? "").localeCompare((b.leas as unknown as { name: string })?.name ?? "") || a.program_code.localeCompare(b.program_code, "en", { numeric: true }));

  return (
    <>
      <PageHeader eyebrow={year.label} title="Programs" description={user.isStaff ? "Declared programs you can see. Open one for its evidence, Form 14-1, credential counts, and self-scores." : "Your programs. Upload evidence any time; it is reviewed only if the program is selected."} />
      <Notices {...notices} />
      {rows.length === 0 ? <Empty>No programs to show.</Empty> : (
        <Table caption="Programs" head={<tr>{user.isStaff && <th className={th}>System</th>}<th className={th}>Program</th><th className={th}>School</th><th className={th}>Teachers</th><th className={th}>Evidence files</th><th className={th}>Form 14-1</th></tr>}>
          {rows.map((p) => (
            <tr key={p.id}>
              {user.isStaff && <td className={td}>{(p.leas as unknown as { name: string } | null)?.name}</td>}
              <td className={td}><Link href={`/app/programs/${p.id}`} className="font-semibold text-brand underline decoration-brand/40 underline-offset-2"><span className="font-mono text-xs">{p.program_code}</span> {(p.program_catalog as unknown as { name: string } | null)?.name}</Link></td>
              <td className={td}>{(p.home as unknown as { name: string; school_code: string } | null)?.name ?? "System-wide"}</td>
              <td className={td}>{((p.declared_program_teachers as unknown as { teachers: { display_name: string } | null }[]) ?? []).map((t) => t.teachers?.display_name).filter(Boolean).join(", ")}</td>
              <td className={`${td} tabular-nums`}>{fileCount.get(p.id) ?? 0}</td>
              <td className={td}>{formStatus.get(p.id) ? <Badge tone={formStatus.get(p.id) === "submitted" ? "good" : "warn"}>{formStatus.get(p.id)}</Badge> : <Badge>Not started</Badge>}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
