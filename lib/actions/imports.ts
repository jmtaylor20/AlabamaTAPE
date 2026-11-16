"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { parseCogniaList, type CogniaPlan } from "@/lib/import/cognia-list";
import { parseDeclarations, type DeclarationPlan } from "@/lib/import/declarations";
import { readWorkbook } from "@/lib/import/sheets";
import { createUserClient } from "@/lib/supabase/server";

/** Importers: parse to a plan, preview, apply. Each apply is idempotent per row. */

const MAX_BYTES = 15 * 1024 * 1024;
const uuid = z.string().uuid();

function go(path: string, notice?: string, error?: string): never {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  revalidatePath(path);
  redirect(params.toString() ? `${path}?${params}` : path);
}

async function fileFrom(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an .xlsx file." } as const;
  if (file.size > MAX_BYTES) return { error: "That file is larger than 15 MB." } as const;
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { error: "Only .xlsx workbooks are accepted." } as const;
  return { file, buffer: await file.arrayBuffer() } as const;
}

export async function previewCogniaImport(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ cycle_id: uuid }).safeParse({ cycle_id: formData.get("cycle_id") });
  if (!parsed.success) go("/app/admin/imports/cognia", undefined, "Choose a cycle.");
  const f = await fileFrom(formData);
  if ("error" in f) go("/app/admin/imports/cognia", undefined, f.error);
  const supabase = await createUserClient();
  const { data: cycle } = await supabase.from("review_cycles").select("id, school_year_id, school_years(label)").eq("id", parsed.data.cycle_id).maybeSingle();
  if (!cycle) go("/app/admin/imports/cognia", undefined, "Cycle not found.");
  const label = (cycle.school_years as unknown as { label: string } | null)?.label ?? "2026-2027";
  const startYear = Number(label.slice(0, 4));
  let plan: CogniaPlan;
  try {
    plan = parseCogniaList(await readWorkbook(f.buffer), startYear);
  } catch {
    go("/app/admin/imports/cognia", undefined, "That workbook could not be read.");
  }
  const { data: job, error } = await supabase
    .from("import_jobs")
    .insert({ kind: "cognia_list", file_name: f.file.name, school_year_id: cycle.school_year_id, plan: { ...plan, cycle_id: cycle.id }, summary: { leas: plan.leas.length, programs: plan.leas.reduce((n, l) => n + l.programs.length, 0), problems: plan.problems.length }, created_by: user.id })
    .select("id")
    .single();
  if (error || !job) go("/app/admin/imports/cognia", undefined, "Could not save the preview.");
  redirect(`/app/admin/imports/cognia/${job.id}`);
}

export async function applyCogniaImport(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ job_id: uuid }).safeParse({ job_id: formData.get("job_id") });
  if (!parsed.success) go("/app/admin/imports/cognia");
  const supabase = await createUserClient();
  const { data: job } = await supabase.from("import_jobs").select("*").eq("id", parsed.data.job_id).eq("kind", "cognia_list").maybeSingle();
  if (!job || job.status !== "previewed") go("/app/admin/imports/cognia", undefined, "That preview is no longer available.");
  const plan = job.plan as CogniaPlan & { cycle_id: string };
  const path = `/app/admin/imports/cognia/${job.id}`;

  const [{ data: cycle }, { data: catalog }, { data: version }, { data: leas }] = await Promise.all([
    supabase.from("review_cycles").select("id, school_year_id").eq("id", plan.cycle_id).single(),
    supabase.from("program_catalog").select("code, name"),
    supabase.from("instrument_versions").select("id").eq("school_year_id", job.school_year_id).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("leas").select("id, name, system_code"),
  ]);
  if (!cycle) go(path, undefined, "The cycle no longer exists.");
  const programByName = new Map((catalog ?? []).map((p) => [p.name.trim().toLowerCase(), p.code]));
  const leaByName = new Map((leas ?? []).map((l) => [l.name.trim().toLowerCase(), l]));
  const result = { leasCreated: 0, reviews: 0, programs: 0, assignments: 0, contacts: 0, skipped: [] as string[] };

  let nextPlaceholder = 700 + (leas ?? []).filter((l) => /^7\d\d$/.test(l.system_code)).length;
  for (const entry of plan.leas) {
    let lea = leaByName.get(entry.lea.trim().toLowerCase());
    if (!lea) {
      const code = String(nextPlaceholder++).padStart(3, "0");
      const { data, error } = await supabase.from("leas").insert({ system_code: code, name: entry.lea.trim(), lea_type: entry.lea.toLowerCase().includes("city") ? "city" : "county", source: "import:cognia", code_is_placeholder: true }).select("id, name, system_code").single();
      if (error || !data) { result.skipped.push(`${entry.lea}: could not create (${error?.message ?? "unknown"})`); continue; }
      lea = data;
      leaByName.set(entry.lea.trim().toLowerCase(), lea);
      result.leasCreated += 1;
    }
    if (entry.director?.email) {
      const { data: existing } = await supabase.from("lea_contacts").select("id").eq("lea_id", lea.id).eq("email", entry.director.email).maybeSingle();
      if (!existing) {
        await supabase.from("lea_contacts").insert({ lea_id: lea.id, contact_role: "cte_director", display_name: entry.director.name || entry.director.email, email: entry.director.email, source: "import:cognia" });
        result.contacts += 1;
      }
    }
    await supabase.from("compliance_list").upsert({ cycle_id: cycle.id, lea_id: lea.id, review_month: entry.reviewMonth, review_year: entry.reviewYear, source: "import:cognia" }, { onConflict: "cycle_id,lea_id" });
    const { data: review, error: reviewError } = await supabase
      .from("lea_reviews")
      .upsert({ cycle_id: cycle.id, lea_id: lea.id, review_month: entry.reviewMonth, review_year: entry.reviewYear }, { onConflict: "cycle_id,lea_id" })
      .select("id, released_at")
      .single();
    if (reviewError || !review) { result.skipped.push(`${entry.lea}: could not create the review (${reviewError?.message ?? "unknown"})`); continue; }
    result.reviews += 1;

    for (const prog of entry.programs) {
      const code = programByName.get(prog.program.trim().toLowerCase());
      if (!code) { result.skipped.push(`${entry.lea} / ${prog.program}: program not in the catalog`); continue; }
      let { data: dp } = await supabase.from("declared_programs").select("id").eq("lea_id", lea.id).eq("school_year_id", cycle.school_year_id).eq("program_code", code).is("home_school_id", null).maybeSingle();
      if (!dp) {
        const inserted = await supabase.from("declared_programs").insert({ lea_id: lea.id, school_year_id: cycle.school_year_id, program_code: code, source: "import:cognia" }).select("id").single();
        dp = inserted.data;
      }
      if (!dp) { result.skipped.push(`${entry.lea} / ${prog.program}: could not record the declaration`); continue; }
      const { data: sel } = await supabase.from("selections").upsert({ lea_review_id: review.id, declared_program_id: dp.id, method: "imported" }, { onConflict: "lea_review_id,declared_program_id" }).select("id").single();
      const { data: pr } = await supabase.from("program_reviews").upsert({ lea_review_id: review.id, selection_id: sel?.id ?? null, program_code: code, instrument_version_id: version?.id ?? null, status: "released" }, { onConflict: "lea_review_id,program_code" }).select("id").single();
      if (!pr) { result.skipped.push(`${entry.lea} / ${prog.program}: could not create the program review`); continue; }
      result.programs += 1;
      const people = [...prog.reviewers.map((r, i) => ({ ...r, role: i === 0 ? "lead_reviewer" : "reviewer" })), ...(prog.admin?.email ? [{ ...prog.admin, role: "cluster_admin" }] : [])];
      for (const person of people) {
        if (!person.email) continue;
        const { data: existing } = await supabase.from("review_assignments").select("id").eq("program_review_id", pr.id).eq("email", person.email).is("revoked_at", null).maybeSingle();
        if (existing) continue;
        const { data: profile } = await supabase.from("profiles").select("id").eq("email", person.email).maybeSingle();
        const { error } = await supabase.from("review_assignments").insert({ program_review_id: pr.id, user_id: profile?.id ?? null, email: person.email, display_name: person.name || null, assignment_role: person.role, assigned_by: user.id });
        if (!error) result.assignments += 1;
      }
    }
    // These systems were notified through Cognia before this app existed; mark them released as of the publish date.
    if (!review.released_at) {
      await supabase.from("lea_reviews").update({ released_at: `${entry.publishDate}T12:00:00Z`, released_by: user.id, status: "released" }).eq("id", review.id);
    }
  }
  await supabase.from("import_jobs").update({ status: "applied", applied_at: new Date().toISOString(), result }).eq("id", job.id);
  await supabase.rpc("log_event", { p_action: "import.cognia_list", p_entity_type: "import_jobs", p_entity_id: job.id, p_meta: result });
  go(path, `Imported ${result.reviews} systems and ${result.programs} program reviews with ${result.assignments} assignments.`);
}

export async function previewDeclarationImport(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ lea_id: uuid, school_year_id: uuid }).safeParse({ lea_id: formData.get("lea_id"), school_year_id: formData.get("school_year_id") });
  if (!parsed.success) go("/app/admin/declarations", undefined, "Choose a system and a school year.");
  const back = `/app/admin/declarations/${parsed.data.lea_id}`;
  const f = await fileFrom(formData);
  if ("error" in f) go(back, undefined, f.error);
  let plan: DeclarationPlan;
  try {
    plan = parseDeclarations(await readWorkbook(f.buffer));
  } catch {
    go(back, undefined, "That workbook could not be read.");
  }
  const supabase = await createUserClient();
  const { data: job, error } = await supabase
    .from("import_jobs")
    .insert({ kind: "declarations", file_name: f.file.name, school_year_id: parsed.data.school_year_id, lea_id: parsed.data.lea_id, plan, summary: { rows: plan.rows.length, withProblems: plan.rows.filter((r) => r.problems.length).length, unmatchedHeaders: plan.unmatchedHeaders }, created_by: user.id })
    .select("id")
    .single();
  if (error || !job) go(back, undefined, "Could not save the preview.");
  redirect(`/app/admin/declarations/${parsed.data.lea_id}/import/${job.id}`);
}

export async function applyDeclarationImport(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ job_id: uuid, replace: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) go("/app/admin/declarations");
  const supabase = await createUserClient();
  const { data: job } = await supabase.from("import_jobs").select("*").eq("id", parsed.data.job_id).eq("kind", "declarations").maybeSingle();
  if (!job || job.status !== "previewed" || !job.lea_id || !job.school_year_id) go("/app/admin/declarations", undefined, "That preview is no longer available.");
  const plan = job.plan as DeclarationPlan;
  const path = `/app/admin/declarations/${job.lea_id}/import/${job.id}`;
  const [{ data: lea }, { data: schools }, { data: catalog }, { data: leas }, { data: teachers }] = await Promise.all([
    supabase.from("leas").select("id, system_code").eq("id", job.lea_id).single(),
    supabase.from("schools").select("id, school_code, lea_id"),
    supabase.from("program_catalog").select("code"),
    supabase.from("leas").select("id, system_code"),
    supabase.from("teachers").select("id, email, display_name").eq("lea_id", job.lea_id),
  ]);
  if (!lea) go(path, undefined, "System not found.");
  const codes = new Set((catalog ?? []).map((c) => c.code));
  const leaByCode = new Map((leas ?? []).map((l) => [l.system_code, l.id]));
  const schoolByKey = new Map((schools ?? []).map((s) => [`${s.lea_id}:${s.school_code}`, s.id]));
  const teacherByEmail = new Map((teachers ?? []).filter((t) => t.email).map((t) => [t.email as string, t.id]));
  const teacherByName = new Map((teachers ?? []).map((t) => [t.display_name.trim().toLowerCase(), t.id]));
  const result = { imported: 0, teachersCreated: 0, skipped: [] as string[] };
  const { data: importRow } = await supabase.from("declaration_imports").insert({ lea_id: job.lea_id, school_year_id: job.school_year_id, file_name: job.file_name, row_count: plan.rows.length, validation: job.summary, imported_by: user.id }).select("id").single();

  if (parsed.data.replace) await supabase.from("declared_programs").update({ status: "removed" }).eq("lea_id", job.lea_id).eq("school_year_id", job.school_year_id);

  for (const r of plan.rows) {
    if (r.problems.length) { result.skipped.push(`Row ${r.row}: ${r.problems.join("; ")}`); continue; }
    if (r.systemCode && r.systemCode !== lea.system_code) { result.skipped.push(`Row ${r.row}: system ${r.systemCode} is not ${lea.system_code}`); continue; }
    if (!codes.has(r.programCode)) { result.skipped.push(`Row ${r.row}: program code ${r.programCode} is not in the catalog`); continue; }
    let schoolId = schoolByKey.get(`${job.lea_id}:${r.schoolCode}`) ?? null;
    if (!schoolId && r.schoolCode) {
      const { data: created } = await supabase.from("schools").insert({ lea_id: job.lea_id, school_code: r.schoolCode, name: r.schoolName || `School ${r.schoolCode}` }).select("id").single();
      if (created) { schoolId = created.id; schoolByKey.set(`${job.lea_id}:${r.schoolCode}`, created.id); }
    }
    const locationLea = r.locationSystemCode ? leaByCode.get(r.locationSystemCode) ?? null : null;
    const locationSchool = locationLea && r.locationSchoolCode ? schoolByKey.get(`${locationLea}:${r.locationSchoolCode}`) ?? null : null;
    const row = { lea_id: job.lea_id, school_year_id: job.school_year_id, home_school_id: schoolId, location_lea_id: locationLea, location_school_id: locationSchool, program_code: r.programCode, delivery_type: r.deliveryType, dual_scenario: r.dualScenario, status: "active", import_id: importRow?.id ?? null, source: "import:declarations" };
    const { data: existing } = await supabase.from("declared_programs").select("id").eq("lea_id", job.lea_id).eq("school_year_id", job.school_year_id).eq("program_code", r.programCode).is("home_school_id", schoolId ? undefined as never : null).eq(schoolId ? "home_school_id" : "program_code", schoolId ?? r.programCode).maybeSingle();
    let dpId = existing?.id ?? null;
    if (dpId) await supabase.from("declared_programs").update(row).eq("id", dpId);
    else {
      const { data: ins, error } = await supabase.from("declared_programs").insert(row).select("id").single();
      if (error || !ins) { result.skipped.push(`Row ${r.row}: ${error?.message ?? "could not save"}`); continue; }
      dpId = ins.id;
    }
    result.imported += 1;
    if (r.teacherName || r.teacherEmail) {
      let teacherId = (r.teacherEmail && teacherByEmail.get(r.teacherEmail)) || teacherByName.get(r.teacherName.trim().toLowerCase()) || null;
      if (!teacherId && (r.teacherName || r.teacherEmail)) {
        const { data: t } = await supabase.from("teachers").insert({ lea_id: job.lea_id, display_name: r.teacherName || r.teacherEmail, email: r.teacherEmail || null }).select("id").single();
        if (t) { teacherId = t.id; result.teachersCreated += 1; if (r.teacherEmail) teacherByEmail.set(r.teacherEmail, t.id); teacherByName.set(r.teacherName.trim().toLowerCase(), t.id); }
      }
      if (teacherId) await supabase.from("declared_program_teachers").upsert({ declared_program_id: dpId, teacher_id: teacherId }, { onConflict: "declared_program_id,teacher_id", ignoreDuplicates: true });
    }
  }
  await supabase.from("import_jobs").update({ status: "applied", applied_at: new Date().toISOString(), result }).eq("id", job.id);
  await supabase.rpc("log_event", { p_action: "import.declarations", p_entity_type: "import_jobs", p_entity_id: job.id, p_lea_id: job.lea_id, p_meta: result });
  go(path, `Imported ${result.imported} declared programs (${result.teachersCreated} new teacher records). ${result.skipped.length} rows skipped.`);
}

export async function discardImport(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ job_id: uuid, return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) go("/app");
  const supabase = await createUserClient();
  await supabase.from("import_jobs").update({ status: "discarded" }).eq("id", parsed.data.job_id).eq("status", "previewed");
  go(parsed.data.return_to, "Preview discarded. Nothing was imported.");
}
