"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";

/** Server actions for cycles, declarations, selection, scheduling, and release. Authorization lives in the database. */

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function back(path: string, notice?: string, error?: string): never {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  const qs = params.toString();
  revalidatePath(path);
  redirect(qs ? `${path}?${qs}` : path);
}

function explain(message: string) {
  if (message.includes("row-level security")) return "You do not have permission to make that change.";
  if (message.includes("duplicate key")) return "That record already exists.";
  if (message.includes("violates check constraint")) return "One of the values is not valid.";
  return message.replace(/^.*?:\s*/, "").slice(0, 200) || "The change could not be saved.";
}

export async function saveCycle(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ school_year_id: uuid, name: z.string().trim().min(2).max(80), target_percent: z.coerce.number().min(1).max(100), january_evidence_due: dateStr.or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "Check the name, target percent, and January evidence date.");
  const supabase = await createUserClient();
  const settings = parsed.data.january_evidence_due ? { january_evidence_due: parsed.data.january_evidence_due } : {};
  const { error } = await supabase.from("review_cycles").upsert({ school_year_id: parsed.data.school_year_id, name: parsed.data.name, target_percent: parsed.data.target_percent, settings }, { onConflict: "school_year_id" });
  back("/app/admin/cycles", error ? undefined : "Cycle saved.", error ? explain(error.message) : undefined);
}

export async function addToComplianceList(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ cycle_id: uuid, lea_id: uuid, review_month: z.coerce.number().int().min(1).max(12), review_year: z.coerce.number().int().min(2020).max(2100), is_carryover: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "Choose a system, month, and year.");
  const d = parsed.data;
  const supabase = await createUserClient();
  if (!d.is_carryover) {
    const { error } = await supabase.from("compliance_list").upsert({ cycle_id: d.cycle_id, lea_id: d.lea_id, review_month: d.review_month, review_year: d.review_year }, { onConflict: "cycle_id,lea_id" });
    if (error) back(`/app/admin/cycles/${d.cycle_id}`, undefined, explain(error.message));
  }
  const { error } = await supabase.from("lea_reviews").upsert({ cycle_id: d.cycle_id, lea_id: d.lea_id, review_month: d.review_month, review_year: d.review_year, is_carryover: !!d.is_carryover }, { onConflict: "cycle_id,lea_id" });
  back(`/app/admin/cycles/${d.cycle_id}`, error ? undefined : "System added to the cycle.", error ? explain(error.message) : undefined);
}

export async function saveSchedule(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({
    lea_review_id: uuid,
    choice1_start: dateStr.or(z.literal("")), choice1_end: dateStr.or(z.literal("")),
    choice2_start: dateStr.or(z.literal("")), choice2_end: dateStr.or(z.literal("")),
    visit_start: dateStr.or(z.literal("")), visit_end: dateStr.or(z.literal("")),
    notes: z.string().max(4000).or(z.literal("")),
    reason: z.string().max(400).or(z.literal("")),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/reviews", undefined, "Check the dates.");
  const d = parsed.data;
  const path = `/app/admin/reviews/${d.lea_review_id}`;
  const supabase = await createUserClient();
  const { data: before } = await supabase.from("lea_reviews").select("released_at, visit_start, visit_end").eq("id", d.lea_review_id).maybeSingle();
  const row = {
    choice1_start: d.choice1_start || null, choice1_end: d.choice1_end || d.choice1_start || null,
    choice2_start: d.choice2_start || null, choice2_end: d.choice2_end || d.choice2_start || null,
    visit_start: d.visit_start || d.choice1_start || null, visit_end: d.visit_end || d.visit_start || d.choice1_end || d.choice1_start || null,
    notes: d.notes || null,
  };
  const { error } = await supabase.from("lea_reviews").update(row).eq("id", d.lea_review_id);
  if (error) back(path, undefined, explain(error.message));
  if (before?.released_at && (before.visit_start !== row.visit_start || before.visit_end !== row.visit_end)) {
    if (!d.reason) back(path, undefined, "A date change after release needs a reason.");
    await supabase.from("scope_changes").insert({ lea_review_id: d.lea_review_id, kind: "date_changed", reason: d.reason, details: { from: [before.visit_start, before.visit_end], to: [row.visit_start, row.visit_end] }, inform: ["director", "teachers", "reviewers", "cluster_admin"], actor_id: user.id });
  }
  back(path, "Schedule saved.");
}

export async function setTarget(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ lea_review_id: uuid, target_override: z.coerce.number().int().min(0).or(z.literal("")), reason: z.string().trim().min(2).max(400) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "Give a count and a reason.");
  const supabase = await createUserClient();
  const value = parsed.data.target_override === "" ? null : parsed.data.target_override;
  const { error } = await supabase.from("lea_reviews").update({ target_override: value, target_override_reason: parsed.data.reason }).eq("id", parsed.data.lea_review_id);
  if (!error) await supabase.from("scope_changes").insert({ lea_review_id: parsed.data.lea_review_id, kind: "target_changed", reason: parsed.data.reason, details: { target_override: value }, actor_id: user.id });
  back(`/app/admin/reviews/${parsed.data.lea_review_id}`, error ? undefined : "Target saved.", error ? explain(error.message) : undefined);
}

export async function nominate(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ lea_review_id: uuid, declared_program_id: uuid, reason: z.string().max(400).or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/reviews");
  const supabase = await createUserClient();
  const { error } = await supabase.from("selections").insert({ lea_review_id: parsed.data.lea_review_id, declared_program_id: parsed.data.declared_program_id, method: user.isStateAdmin ? "manual" : "nominated", nominated_by: user.id, nomination_reason: parsed.data.reason || null });
  back(parsed.data.return_to, error ? undefined : "Program added to the review list.", error ? explain(error.message) : undefined);
}

export async function removeSelection(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ selection_id: uuid, lea_review_id: uuid, reason: z.string().trim().min(2).max(400) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "A reason is required to remove a program.");
  const supabase = await createUserClient();
  const { data: sel } = await supabase.from("selections").select("declared_program_id, declared_programs(program_code)").eq("id", parsed.data.selection_id).maybeSingle();
  const { error } = await supabase.from("selections").update({ status: "removed", removal_reason: parsed.data.reason, removed_by: user.id, removed_at: new Date().toISOString() }).eq("id", parsed.data.selection_id);
  if (!error) {
    const code = (sel?.declared_programs as unknown as { program_code: string } | null)?.program_code;
    if (code) await supabase.from("program_reviews").update({ status: "removed" }).eq("lea_review_id", parsed.data.lea_review_id).eq("program_code", code);
    await supabase.from("scope_changes").insert({ lea_review_id: parsed.data.lea_review_id, kind: "program_removed", reason: parsed.data.reason, details: { program_code: code }, inform: ["director", "teachers", "reviewers"], actor_id: user.id });
  }
  back(`/app/admin/reviews/${parsed.data.lea_review_id}`, error ? undefined : "Program removed from the review.", error ? explain(error.message) : undefined);
}

export async function runDraw(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ lea_review_id: uuid, seed: z.string().trim().min(1).max(80) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "Give the draw a seed.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("run_selection_draw", { p_lea_review: parsed.data.lea_review_id, p_seed: parsed.data.seed });
  if (!error) await supabase.rpc("materialize_program_reviews", { p_lea_review: parsed.data.lea_review_id });
  back(`/app/admin/reviews/${parsed.data.lea_review_id}`, error ? undefined : "Draw complete. The seed and result are recorded.", error ? explain(error.message) : undefined);
}

export async function assignReviewer(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ program_review_id: uuid, lea_review_id: uuid, email: z.string().trim().toLowerCase().email(), display_name: z.string().trim().max(120).or(z.literal("")), assignment_role: z.enum(["lead_reviewer", "reviewer", "cluster_admin"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "Enter an email and choose a role.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { data: profile } = await supabase.from("profiles").select("id, display_name").eq("email", d.email).maybeSingle();
  const { data: review } = await supabase.from("lea_reviews").select("released_at").eq("id", d.lea_review_id).maybeSingle();
  const { error } = await supabase.from("review_assignments").insert({ program_review_id: d.program_review_id, user_id: profile?.id ?? null, email: d.email, display_name: d.display_name || profile?.display_name || null, assignment_role: d.assignment_role, assigned_by: user.id });
  if (!error && review?.released_at) await supabase.from("scope_changes").insert({ lea_review_id: d.lea_review_id, kind: "reviewer_added", reason: "Assigned after release", details: { email: d.email, role: d.assignment_role }, inform: ["director", "reviewers"], actor_id: user.id });
  back(`/app/admin/reviews/${d.lea_review_id}`, error ? undefined : `${d.email} assigned.`, error ? explain(error.message) : undefined);
}

export async function revokeAssignment(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ id: uuid, lea_review_id: uuid, reason: z.string().trim().min(2).max(400) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "A reason is required to remove a reviewer.");
  const supabase = await createUserClient();
  const { data: a } = await supabase.from("review_assignments").select("email, assignment_role").eq("id", parsed.data.id).maybeSingle();
  const { error } = await supabase.from("review_assignments").update({ revoked_at: new Date().toISOString(), revoke_reason: parsed.data.reason }).eq("id", parsed.data.id);
  if (!error) await supabase.from("scope_changes").insert({ lea_review_id: parsed.data.lea_review_id, kind: "reviewer_removed", reason: parsed.data.reason, details: { email: a?.email, role: a?.assignment_role }, inform: ["director", "reviewers"], actor_id: user.id });
  back(`/app/admin/reviews/${parsed.data.lea_review_id}`, error ? undefined : "Reviewer removed.", error ? explain(error.message) : undefined);
}

export async function releaseNotification(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ lea_review_id: uuid, confirm: z.literal("RELEASE") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles", undefined, "Type RELEASE to confirm.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("release_notification", { p_lea_review: parsed.data.lea_review_id });
  back(`/app/admin/reviews/${parsed.data.lea_review_id}`, error ? undefined : "Notification released. The system can now see its programs, reviewers, and dates.", error ? explain(error.message) : undefined);
}

export async function setLeaReviewStatus(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ lea_review_id: uuid, status: z.enum(["listed", "selected", "scheduled", "checked_in", "released", "evidence_due", "desk_audit", "onsite", "post_visit", "concluded"]), notes: z.string().max(4000).or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/cycles");
  const supabase = await createUserClient();
  const patch: Record<string, unknown> = { status: parsed.data.status, notes: parsed.data.notes || null };
  if (parsed.data.status === "checked_in") patch.checked_in_at = new Date().toISOString();
  if (parsed.data.status === "concluded") patch.concluded_at = new Date().toISOString();
  const { error } = await supabase.from("lea_reviews").update(patch).eq("id", parsed.data.lea_review_id);
  back(`/app/admin/reviews/${parsed.data.lea_review_id}`, error ? undefined : "Status saved.", error ? explain(error.message) : undefined);
}

export async function saveProgramReviewNotes(formData: FormData) {
  await requireUser();
  const parsed = z.object({ program_review_id: uuid, lea_review_id: uuid, status: z.enum(["selected", "released", "evidence_submitted", "desk_audit", "onsite", "post_visit", "finalized", "concluded"]), pip_expected: z.enum(["on"]).optional(), notes: z.string().max(4000).or(z.literal("")), visit_date: dateStr.or(z.literal("")), sequence: z.coerce.number().int().min(0).or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/reviews", undefined, "Check the values.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("program_reviews").update({ status: d.status, pip_expected: !!d.pip_expected, notes: d.notes || null, visit_date: d.visit_date || null, sequence: d.sequence === "" ? null : d.sequence, updated_at: new Date().toISOString() }).eq("id", d.program_review_id);
  back(`/app/admin/reviews/${d.lea_review_id}`, error ? undefined : "Program review saved.", error ? explain(error.message) : undefined);
}

export async function openDeclarationWindow(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ lea_id: uuid, school_year_id: uuid, closes_at: dateStr, note: z.string().max(400).or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/declarations", undefined, "Choose a closing date.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("declaration_windows").insert({ lea_id: parsed.data.lea_id, school_year_id: parsed.data.school_year_id, closes_at: `${parsed.data.closes_at}T23:59:59`, opened_by: user.id, note: parsed.data.note || null });
  back(`/app/admin/declarations/${parsed.data.lea_id}`, error ? undefined : "Review window opened. The Director can now make changes until it closes or they confirm.", error ? explain(error.message) : undefined);
}

export async function closeDeclarationWindow(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ id: uuid, lea_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/declarations");
  const supabase = await createUserClient();
  const { error } = await supabase.from("declaration_windows").update({ closed_early_at: new Date().toISOString(), closed_by: user.id }).eq("id", parsed.data.id);
  back(`/app/admin/declarations/${parsed.data.lea_id}`, error ? undefined : "Window closed.", error ? explain(error.message) : undefined);
}

export async function confirmDeclarations(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ window_id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/lea/declarations");
  const supabase = await createUserClient();
  const { error, count } = await supabase.from("declaration_windows").update({ confirmed_at: new Date().toISOString(), confirmed_by: user.id }, { count: "exact" }).eq("id", parsed.data.window_id);
  if (!error && count) await supabase.rpc("log_event", { p_action: "declarations.confirmed", p_entity_type: "declaration_windows", p_entity_id: parsed.data.window_id, p_lea_id: user.leaIds[0] ?? null });
  back("/app/lea/declarations", error || !count ? undefined : "Declarations confirmed. Thank you.", error ? explain(error.message) : !count ? "Only the CTE Director can confirm, and only while the window is open." : undefined);
}

export async function saveDeclaredProgram(formData: FormData) {
  await requireUser();
  const parsed = z.object({
    id: uuid.or(z.literal("")), lea_id: uuid, school_year_id: uuid, home_school_id: uuid.or(z.literal("")), program_code: z.string().regex(/^\d{1,3}$/),
    delivery_type: z.enum(["LOCAL", "DUAL", "ACCESS"]), dual_scenario: z.enum(["", "1", "2", "3", "4", "5"]), location_lea_id: uuid.or(z.literal("")), location_school_id: uuid.or(z.literal("")),
    ase_accredited: z.enum(["on"]).optional(), vacant: z.enum(["on"]).optional(), first_year_teacher: z.enum(["on"]).optional(), epic_requested: z.enum(["on"]).optional(),
    status: z.enum(["active", "removed"]).optional(), teacher_ids: z.string().or(z.literal("")).optional(), return_to: z.string().startsWith("/app"),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the program, school, and delivery type.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const row = {
    lea_id: d.lea_id, school_year_id: d.school_year_id, home_school_id: d.home_school_id || null, program_code: d.program_code, delivery_type: d.delivery_type,
    dual_scenario: d.delivery_type === "DUAL" && d.dual_scenario ? Number(d.dual_scenario) : null, location_lea_id: d.location_lea_id || null, location_school_id: d.location_school_id || null,
    ase_accredited: !!d.ase_accredited, vacant: !!d.vacant, first_year_teacher: !!d.first_year_teacher, epic_requested: !!d.epic_requested, status: d.status ?? "active",
  };
  let id = d.id;
  if (id) {
    const { error, count } = await supabase.from("declared_programs").update(row, { count: "exact" }).eq("id", id);
    if (error || !count) back(d.return_to, undefined, error ? explain(error.message) : "This declaration is read-only right now. Changes are allowed only while your review window is open.");
  } else {
    const { data, error } = await supabase.from("declared_programs").insert(row).select("id").single();
    if (error || !data) back(d.return_to, undefined, error ? explain(error.message) : "Could not add the program.");
    id = data.id;
  }
  const teacherIds = (formData.getAll("teacher_ids") as string[]).filter((t) => /^[0-9a-f-]{36}$/.test(t));
  const { data: existing } = await supabase.from("declared_program_teachers").select("teacher_id").eq("declared_program_id", id);
  const have = new Set((existing ?? []).map((e) => e.teacher_id));
  for (const t of teacherIds) if (!have.has(t)) await supabase.from("declared_program_teachers").insert({ declared_program_id: id, teacher_id: t });
  for (const t of have) if (!teacherIds.includes(t)) await supabase.from("declared_program_teachers").delete().eq("declared_program_id", id).eq("teacher_id", t);
  back(d.return_to, "Declaration saved.");
}
