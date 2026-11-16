import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";
import { Alert, Badge, Card, Empty, PageHeader } from "@/lib/ui";

export const metadata: Metadata = { title: "Instrument" };

/** Read-only view of the published instrument. Published versions never change; a new year gets a new version. */
export default async function InstrumentPage() {
  const user = await requireUser();
  const supabase = await createUserClient();
  const { data: versions } = await supabase.from("instrument_versions").select("id, label, status, published_at, notes, school_years(label)").order("created_at", { ascending: false });
  const version = (versions ?? []).find((v) => v.status === "published") ?? (versions ?? [])[0];
  if (!version) return <><PageHeader title="Instrument" /><Empty>No instrument version is loaded yet.</Empty></>;
  const [{ data: sections }, { data: qpis }, { data: subitems }, { data: epic }, { data: rules }, { data: checklist }] = await Promise.all([
    supabase.from("instrument_sections").select("id, code, title, purpose, sort").eq("version_id", version.id).order("sort"),
    supabase.from("qpis").select("id, section_id, code, title, descriptor, applies_to, assurance_based, onsite, per_teacher, satisfied_by_ase, dual_scenario3_included, random_audit_kind, sort").eq("version_id", version.id).order("sort"),
    supabase.from("qpi_subitems").select("qpi_id, text, allows_na, sort").order("sort"),
    supabase.from("epic_descriptors").select("section_id, text, sort").eq("version_id", version.id).order("sort"),
    supabase.from("scoring_rules").select("rule_key, label, operator, threshold, epic_threshold, unit").eq("version_id", version.id),
    supabase.from("checklist_items").select("role, text, sort").eq("version_id", version.id).order("sort"),
  ]);

  return (
    <>
      <PageHeader eyebrow={(version.school_years as unknown as { label: string } | null)?.label ?? ""} title={version.label} description={version.status === "published" ? `Published ${fmtDateTime(version.published_at)}. This version is locked; scores recorded against it always show the wording the reviewer saw.` : "Draft."} actions={<Badge tone={version.status === "published" ? "good" : "warn"}>{version.status}</Badge>} />
      {version.notes && <div className="mb-4"><Alert tone="info">{version.notes}</Alert></div>}
      <div className="space-y-6">
        {(sections ?? []).map((s) => (
          <Card key={s.id} title={`${s.code} ${s.title}`}>
            {s.purpose && <details className="mb-3 text-sm text-ink-muted"><summary className="cursor-pointer font-semibold text-brand">Purpose</summary><p className="mt-1 max-w-prose">{s.purpose}</p></details>}
            <ol className="space-y-4">
              {(qpis ?? []).filter((q) => q.section_id === s.id).map((q) => (
                <li key={q.id} className="rounded-md border border-line p-3">
                  <p className="font-semibold">{q.code} {q.title} {q.onsite && <Badge tone="warn">Onsite</Badge>} {q.assurance_based && <Badge>Director assurance</Badge>} {q.per_teacher && <Badge>Per teacher</Badge>} {q.satisfied_by_ase && <Badge>ASE satisfies</Badge>} {q.dual_scenario3_included && <Badge tone="good">Dual 3</Badge>} {q.random_audit_kind && <Badge tone="warn">Random audit</Badge>} {q.applies_to === "coop_only" && <Badge>Co-op only</Badge>}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{q.descriptor}</p>
                  {(subitems ?? []).filter((x) => x.qpi_id === q.id).length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{(subitems ?? []).filter((x) => x.qpi_id === q.id).map((x, i) => <li key={i}>{x.text}{x.allows_na && <span className="text-ink-muted"> (N/A allowed)</span>}</li>)}</ul>}
                </li>
              ))}
            </ol>
            {(epic ?? []).filter((e) => e.section_id === s.id).length > 0 && (
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-brand">EPIC descriptors</summary><ul className="mt-1 list-disc pl-5">{(epic ?? []).filter((e) => e.section_id === s.id).map((e, i) => <li key={i}>{e.text}</li>)}</ul></details>
            )}
          </Card>
        ))}
        <Card title="Scoring thresholds">
          <ul className="divide-y divide-line text-sm">{(rules ?? []).map((r) => <li key={r.rule_key} className="flex flex-wrap justify-between gap-2 py-2"><span>{r.label}</span><span className="tabular-nums">{r.operator} {Number(r.threshold)} {r.unit}{r.epic_threshold !== null && ` (EPIC ${Number(r.epic_threshold)})`}</span></li>)}</ul>
        </Card>
        {user.isStaff && (
          <div className="grid gap-6 lg:grid-cols-2">
            {(["director", "reviewer"] as const).map((role) => <Card key={role} title={role === "director" ? "CTE Director checklist" : "Reviewer checklist"}><ol className="list-decimal space-y-1 pl-5 text-sm">{(checklist ?? []).filter((c) => c.role === role).map((c, i) => <li key={i}>{c.text}</li>)}</ol></Card>)}
          </div>
        )}
      </div>
    </>
  );
}
