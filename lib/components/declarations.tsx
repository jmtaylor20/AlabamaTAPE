import { fmtDateTime } from "@/lib/format";
import { Badge, Button, Field, Select, Table, td, th } from "@/lib/ui";

/** Shared pieces for the Director's and the State Admin's declaration pages. */

export type DeclaredProgramRow = {
  id: string; program_code: string; delivery_type: string; dual_scenario: number | null; status: string; ase_accredited: boolean; vacant: boolean; first_year_teacher: boolean; epic_requested: boolean;
  home_school_id: string | null; location_lea_id: string | null; location_school_id: string | null; source: string; updated_at: string;
  program_catalog: { name: string; cluster_code: string } | null; home: { name: string; school_code: string } | null; location: { name: string } | null;
  declared_program_teachers: { teacher_id: string; teachers: { display_name: string } | null }[];
};
export type Revision = { id: number; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; reason: string | null; actor_id: string | null; occurred_at: string; window_id: string | null };
type Option = { id: string; name: string; school_code?: string; system_code?: string };
type Catalog = { code: string; name: string; cluster_code: string };
type Props = { returnTo: string; leaId: string; schoolYearId: string; schools: Option[]; catalog: Catalog[]; teachers: { id: string; display_name: string }[]; leas: Option[]; action: (formData: FormData) => Promise<void> };

export function DeclarationForm({ row, returnTo, leaId, schoolYearId, schools, catalog, teachers, leas, action }: Props & { row?: DeclaredProgramRow }) {
  const k = row?.id ?? "new";
  const chosen = new Set((row?.declared_program_teachers ?? []).map((t) => t.teacher_id));
  return (
    <form action={action} className="mt-2 grid gap-3 sm:grid-cols-3">
      <input type="hidden" name="id" value={row?.id ?? ""} /><input type="hidden" name="lea_id" value={leaId} /><input type="hidden" name="school_year_id" value={schoolYearId} /><input type="hidden" name="return_to" value={returnTo} /><input type="hidden" name="status" value={row?.status ?? "active"} />
      <Field id={`p-${k}`} label="Program">
        <Select id={`p-${k}`} name="program_code" defaultValue={row?.program_code ?? ""} required>
          <option value="">Choose</option>{catalog.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
        </Select>
      </Field>
      <Field id={`s-${k}`} label="Home school">
        <Select id={`s-${k}`} name="home_school_id" defaultValue={row?.home_school_id ?? ""}><option value="">System-wide</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.school_code} {s.name}</option>)}</Select>
      </Field>
      <Field id={`d-${k}`} label="Delivery">
        <Select id={`d-${k}`} name="delivery_type" defaultValue={row?.delivery_type ?? "LOCAL"}><option value="LOCAL">LOCAL</option><option value="DUAL">DUAL</option><option value="ACCESS">ACCESS</option></Select>
      </Field>
      <Field id={`ds-${k}`} label="Dual scenario" hint="1 to 3 are eligible; 4 and 5 are not.">
        <Select id={`ds-${k}`} name="dual_scenario" defaultValue={row?.dual_scenario ? String(row.dual_scenario) : ""}><option value="">Not dual</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select>
      </Field>
      <Field id={`ll-${k}`} label="Taught at another system (optional)">
        <Select id={`ll-${k}`} name="location_lea_id" defaultValue={row?.location_lea_id ?? ""}><option value="">This system</option>{leas.filter((l) => l.id !== leaId).map((l) => <option key={l.id} value={l.id}>{l.system_code} {l.name}</option>)}</Select>
      </Field>
      <input type="hidden" name="location_school_id" value={row?.location_school_id ?? ""} />
      <Field id={`t-${k}`} label="Teachers" hint="Hold Ctrl or Command to choose more than one.">
        <Select id={`t-${k}`} name="teacher_ids" multiple defaultValue={[...chosen]} className="min-h-24">{teachers.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select>
      </Field>
      <div className="flex flex-col gap-2 text-sm sm:col-span-3 sm:flex-row sm:flex-wrap sm:gap-5">
        <label className="flex items-center gap-2"><input type="checkbox" name="ase_accredited" defaultChecked={row?.ase_accredited} className="h-5 w-5" /> ASE accredited</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="vacant" defaultChecked={row?.vacant} className="h-5 w-5" /> Vacant position</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="first_year_teacher" defaultChecked={row?.first_year_teacher} className="h-5 w-5" /> First-year teacher</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="epic_requested" defaultChecked={row?.epic_requested} className="h-5 w-5" /> Request EPIC evaluation</label>
      </div>
      <div className="sm:col-span-3"><Button type="submit" variant="secondary">{row ? "Save changes" : "Add program"}</Button></div>
    </form>
  );
}

export function DeclarationTable({ rows, editable, ...props }: Props & { rows: DeclaredProgramRow[]; editable: boolean }) {
  if (rows.length === 0) return <p className="rounded-md border border-dashed border-line px-4 py-6 text-center text-sm text-ink-muted">No programs declared for this school year.</p>;
  return (
    <Table caption="Declared programs" head={<tr><th className={th}>Program</th><th className={th}>School</th><th className={th}>Teachers</th><th className={th}>Delivery</th><th className={th}>Flags</th><th className={th}>Status</th>{editable && <th className={th}>Edit</th>}</tr>}>
      {rows.map((d) => (
        <tr key={d.id} className={d.status === "removed" ? "opacity-60" : ""}>
          <td className={td}><span className="font-mono text-xs">{d.program_code}</span> {d.program_catalog?.name}</td>
          <td className={td}>{d.home ? `${d.home.school_code} ${d.home.name}` : "System-wide"}{d.location && <span className="block text-xs text-ink-muted">at {d.location.name}</span>}</td>
          <td className={td}>{d.declared_program_teachers.map((t) => t.teachers?.display_name).filter(Boolean).join(", ") || <span className="text-ink-muted">None listed</span>}</td>
          <td className={td}>{d.delivery_type}{d.dual_scenario ? ` ${d.dual_scenario}` : ""}</td>
          <td className={td}>{d.ase_accredited && <Badge>ASE</Badge>} {d.vacant && <Badge tone="warn">Vacant</Badge>} {d.first_year_teacher && <Badge tone="warn">First year</Badge>} {d.epic_requested && <Badge tone="good">EPIC</Badge>}</td>
          <td className={td}>{d.status === "active" ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Removed</Badge>}</td>
          {editable && (
            <td className={td}>
              <details><summary className="cursor-pointer text-sm font-semibold text-brand">Edit</summary><DeclarationForm row={d} {...props} />
                {d.status === "active" && (
                  <form action={props.action} className="mt-2">
                    <input type="hidden" name="id" value={d.id} /><input type="hidden" name="lea_id" value={props.leaId} /><input type="hidden" name="school_year_id" value={props.schoolYearId} /><input type="hidden" name="return_to" value={props.returnTo} />
                    <input type="hidden" name="program_code" value={d.program_code} /><input type="hidden" name="home_school_id" value={d.home_school_id ?? ""} /><input type="hidden" name="delivery_type" value={d.delivery_type} /><input type="hidden" name="dual_scenario" value={d.dual_scenario ?? ""} />
                    <input type="hidden" name="location_lea_id" value={d.location_lea_id ?? ""} /><input type="hidden" name="location_school_id" value={d.location_school_id ?? ""} /><input type="hidden" name="status" value="removed" />
                    {d.ase_accredited && <input type="hidden" name="ase_accredited" value="on" />}{d.epic_requested && <input type="hidden" name="epic_requested" value="on" />}
                    {d.declared_program_teachers.map((t) => <input key={t.teacher_id} type="hidden" name="teacher_ids" value={t.teacher_id} />)}
                    <Button type="submit" variant="danger" className="min-h-9 px-3 text-xs">Mark as not offered</Button>
                  </form>
                )}
              </details>
            </td>
          )}
        </tr>
      ))}
    </Table>
  );
}

const FIELDS: [string, string][] = [["program_code", "program"], ["home_school_id", "school"], ["delivery_type", "delivery"], ["dual_scenario", "dual scenario"], ["location_lea_id", "location system"], ["ase_accredited", "ASE"], ["vacant", "vacant"], ["first_year_teacher", "first-year"], ["epic_requested", "EPIC"], ["status", "status"], ["teacher_id", "teacher"]];

function describe(r: Revision) {
  if (r.action === "declared_programs.insert") return `Added program ${String(r.after?.program_code ?? "")}`;
  if (r.action === "declared_program_teachers.insert") return "Added a teacher to a program";
  if (r.action === "declared_program_teachers.delete") return "Removed a teacher from a program";
  const diffs: string[] = [];
  for (const [key, label] of FIELDS) {
    const b = r.before?.[key]; const a = r.after?.[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) diffs.push(`${label}: ${b === null || b === undefined ? "none" : String(b)} to ${a === null || a === undefined ? "none" : String(a)}`);
  }
  return diffs.length ? `Program ${String(r.after?.program_code ?? r.before?.program_code ?? "")}: ${diffs.join("; ")}` : `Program ${String(r.after?.program_code ?? "")} saved without changes`;
}

export function RevisionList({ revisions, windowIds }: { revisions: Revision[]; windowIds: Set<string> }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {revisions.map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline gap-2 py-2">
          <span className="tabular-nums text-ink-muted">{fmtDateTime(r.occurred_at)}</span>
          <span>{describe(r)}</span>
          {r.window_id && windowIds.has(r.window_id) ? <Badge tone="warn">During review window</Badge> : <Badge>By ALSDE</Badge>}
        </li>
      ))}
    </ul>
  );
}
