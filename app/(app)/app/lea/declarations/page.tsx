import type { Metadata } from "next";
import { confirmDeclarations, saveDeclaredProgram } from "@/lib/actions/cycles";
import { requireUser } from "@/lib/auth/session";
import { DeclarationForm, DeclarationTable, RevisionList, type DeclaredProgramRow, type Revision } from "@/lib/components/declarations";
import { Notices, readNotices, type SearchParams } from "@/lib/components/notices";
import { fmtDateTime, windowOpen } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Button, Card, PageHeader } from "@/lib/ui";

export const metadata: Metadata = { title: "Declared programs" };
const here = "/app/lea/declarations";

/** The Director's one-time review of the programs declared through PowerSchool. Editable only while ALSDE has the window open. */
export default async function LeaDeclarationsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const notices = await readNotices(searchParams);
  const leaId = user.leaIds[0];
  if (!leaId) return <Alert tone="warning">Your account is not attached to a system.</Alert>;
  const isDirector = user.grants.some((g) => g.role === "cte_director" && g.lea_id === leaId);
  const manages = isDirector || user.grants.some((g) => g.role === "lea_staff" && g.lea_id === leaId);
  const supabase = await createUserClient();
  const [{ data: lea }, { data: year }] = await Promise.all([
    supabase.from("leas").select("id, system_code, name").eq("id", leaId).maybeSingle(),
    supabase.from("school_years").select("id, label").eq("is_current", true).maybeSingle(),
  ]);
  if (!lea || !year) return <Alert tone="warning">Your system record or the current school year could not be loaded.</Alert>;
  const [{ data: declared }, { data: windows }, { data: revisions }, { data: schools }, { data: catalog }, { data: teachers }, { data: leas }] = await Promise.all([
    supabase.from("declared_programs").select("*, program_catalog(name, cluster_code, active), home:schools!declared_programs_home_school_id_fkey(name, school_code), location:leas!declared_programs_location_lea_id_fkey(name), declared_program_teachers(teacher_id, teachers(display_name))").eq("lea_id", leaId).eq("school_year_id", year.id).order("program_code"),
    supabase.from("declaration_windows").select("*").eq("lea_id", leaId).eq("school_year_id", year.id).order("opens_at", { ascending: false }),
    supabase.from("declaration_revisions").select("id, action, before, after, reason, actor_id, occurred_at, window_id").eq("lea_id", leaId).eq("school_year_id", year.id).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("schools").select("id, school_code, name").eq("lea_id", leaId).eq("active", true).order("school_code"),
    supabase.from("program_catalog").select("code, name, cluster_code").eq("active", true).order("code"),
    supabase.from("teachers").select("id, display_name").eq("lea_id", leaId).eq("status", "active").order("display_name"),
    supabase.from("leas").select("id, system_code, name").eq("active", true).order("name"),
  ]);
  const current = (windows ?? [])[0];
  const open = windowOpen(current);
  const editable = open && manages;
  const formProps = { returnTo: here, leaId, schoolYearId: year.id, schools: schools ?? [], catalog: catalog ?? [], teachers: teachers ?? [], leas: leas ?? [], action: saveDeclaredProgram };

  return (
    <>
      <PageHeader eyebrow={`${lea.name} / ${year.label}`} title="Declared programs" description="The CTE programs your system declared through PowerSchool. These are the programs that can be selected for a TAPE review." />
      <Notices {...notices} />
      <div className="mb-4">
        {open ? (
          <Alert tone="warning" title={`Your review window is open until ${fmtDateTime(current.closes_at)}`}>
            Check every program, school, and teacher. Add anything missing and mark anything not offered. {current.note && <span className="block">{current.note}</span>}
            {isDirector ? <span className="block">When the list is right, confirm it below. After confirming, or after the window closes, changes go through ALSDE.</span> : <span className="block">Only the CTE Director can confirm the list.</span>}
          </Alert>
        ) : current?.confirmed_at ? (
          <Alert tone="success">Confirmed {fmtDateTime(current.confirmed_at)}. Contact the TAPE liaison if something needs to change.</Alert>
        ) : (
          <Alert tone="info">This list is read-only right now. ALSDE will open a review window when it is time to check it, and you will have one chance to make changes.</Alert>
        )}
      </div>
      <Card title={`Programs (${(declared ?? []).filter((d) => d.status === "active").length})`}>
        <DeclarationTable rows={(declared ?? []) as unknown as DeclaredProgramRow[]} editable={editable} {...formProps} />
        {editable && (
          <details className="mt-4"><summary className="cursor-pointer font-semibold text-brand">Add a program that is missing</summary><DeclarationForm {...formProps} /></details>
        )}
      </Card>
      {open && isDirector && (
        <Card title="Confirm your declarations" className="mt-6">
          <p className="text-sm">By confirming, you attest that this list is complete and correct for {year.label}. Your changes during this window are recorded.</p>
          <form action={confirmDeclarations} className="mt-3"><input type="hidden" name="window_id" value={current.id} /><Button type="submit">Confirm the list</Button></form>
        </Card>
      )}
      {manages && (revisions ?? []).length > 0 && (
        <Card title="Changes" className="mt-6"><RevisionList revisions={(revisions ?? []) as unknown as Revision[]} windowIds={new Set((windows ?? []).map((w) => w.id))} /></Card>
      )}
    </>
  );
}
