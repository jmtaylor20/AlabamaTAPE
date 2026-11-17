"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Server actions for the records the State Admin and Directors maintain.
 * Every write goes through the user's own database session, so row-level
 * security decides whether it is allowed. The role checks here only pick the
 * right error message early; they are not the authorization.
 */

const uuid = z.string().uuid();
const roleEnum = z.enum(["state_admin", "cluster_admin", "reviewer", "cte_director", "lea_staff", "teacher", "leadership", "developer"]);

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
  return "The change could not be saved.";
}

// ---------------------------------------------------------------------------
// LEAs and schools
// ---------------------------------------------------------------------------
export async function saveLea(formData: FormData) {
  await requireRole("state_admin");
  const schema = z.object({
    id: uuid.optional().or(z.literal("")),
    system_code: z.string().trim().regex(/^\d{3}$/),
    name: z.string().trim().min(2).max(120),
    lea_type: z.enum(["county", "city", "charter", "college", "other"]),
    active: z.coerce.boolean(),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/leas", undefined, "Check the system code (three digits) and name.");
  const { id, ...row } = parsed.data;
  const supabase = await createUserClient();
  const query = id ? supabase.from("leas").update(row).eq("id", id) : supabase.from("leas").insert(row);
  const { error } = await query;
  if (error) back("/app/admin/leas", undefined, explain(error.message));
  back(id ? `/app/admin/leas/${id}` : "/app/admin/leas", "Saved.");
}

export async function saveSchool(formData: FormData) {
  await requireUser();
  const schema = z.object({
    id: uuid.optional().or(z.literal("")),
    lea_id: uuid,
    school_code: z.string().trim().regex(/^\d{4}$/),
    name: z.string().trim().min(2).max(120),
    school_type: z.enum(["high_school", "middle_school", "career_tech_center", "college", "other"]),
    active: z.coerce.boolean(),
    return_to: z.string().startsWith("/app"),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the school code (four digits) and name.");
  const { id, return_to, ...row } = parsed.data;
  const supabase = await createUserClient();
  const { error } = id ? await supabase.from("schools").update(row).eq("id", id) : await supabase.from("schools").insert(row);
  if (error) back(return_to, undefined, explain(error.message));
  back(return_to, "School saved.");
}

export async function saveDomain(formData: FormData) {
  await requireRole("state_admin");
  const schema = z.object({ lea_id: uuid.or(z.literal("")), domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/), return_to: z.string().startsWith("/app") });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Enter a domain like example.k12.al.us.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("approved_domains").insert({ lea_id: parsed.data.lea_id || null, domain: parsed.data.domain });
  if (error) back(parsed.data.return_to, undefined, explain(error.message));
  back(parsed.data.return_to, "Domain approved.");
}

export async function setDomainActive(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ id: uuid, active: z.enum(["true", "false"]), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.from("approved_domains").update({ active: parsed.data.active === "true" }).eq("id", parsed.data.id);
  back(parsed.data.return_to, error ? undefined : "Domain updated.", error ? explain(error.message) : undefined);
}

// ---------------------------------------------------------------------------
// Teachers
// ---------------------------------------------------------------------------
export async function saveTeacher(formData: FormData) {
  await requireUser();
  const schema = z.object({
    id: uuid.optional().or(z.literal("")),
    lea_id: uuid,
    display_name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(254).or(z.literal("")),
    alsde_teacher_id: z.string().trim().max(40).or(z.literal("")),
    status: z.enum(["active", "inactive"]),
    contract_type: z.enum(["nine_month", "extended"]).optional(),
    first_year: z.enum(["on"]).optional(),
    school_year_id: uuid.optional().or(z.literal("")),
    return_to: z.string().startsWith("/app"),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the teacher's name and email.");
  const { id, return_to, contract_type, first_year, school_year_id, ...rest } = parsed.data;
  const row = { ...rest, email: rest.email || null, alsde_teacher_id: rest.alsde_teacher_id || null };
  const supabase = await createUserClient();
  let teacherId = id || "";
  if (teacherId) {
    const { error } = await supabase.from("teachers").update(row).eq("id", teacherId);
    if (error) back(return_to, undefined, explain(error.message));
  } else {
    const { data, error } = await supabase.from("teachers").insert(row).select("id").single();
    if (error || !data) back(return_to, undefined, explain(error?.message ?? ""));
    teacherId = data.id;
  }
  if (school_year_id && contract_type) {
    const { error } = await supabase.from("teacher_years").upsert({ teacher_id: teacherId, school_year_id, contract_type, first_year: first_year === "on" }, { onConflict: "teacher_id,school_year_id" });
    if (error) back(return_to, undefined, explain(error.message));
  }
  back(return_to, "Teacher saved.");
}

// ---------------------------------------------------------------------------
// Invitations, grants, accounts
// ---------------------------------------------------------------------------
export async function createInvitation(formData: FormData) {
  const user = await requireUser();
  const schema = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    display_name: z.string().trim().max(120).or(z.literal("")),
    role: roleEnum,
    lea_id: uuid.or(z.literal("")),
    cluster_code: z.string().regex(/^\d{2}$/).or(z.literal("")),
    teacher_id: uuid.or(z.literal("")),
    return_to: z.string().startsWith("/app"),
  });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the email address and role.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("invitations").insert({
    email: d.email,
    display_name: d.display_name || null,
    role: d.role,
    lea_id: d.lea_id || null,
    cluster_code: d.cluster_code || null,
    teacher_id: d.teacher_id || null,
    invited_by: user.id,
  });
  if (error) back(d.return_to, undefined, explain(error.message));
  back(d.return_to, `Invitation created for ${d.email}. They can sign in with that address now.`);
}

export async function revokeInvitation(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ id: uuid, return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).eq("id", parsed.data.id).is("accepted_at", null);
  back(parsed.data.return_to, error ? undefined : "Invitation revoked.", error ? explain(error.message) : undefined);
}

export async function addGrant(formData: FormData) {
  const user = await requireRole("state_admin");
  const schema = z.object({ user_id: uuid, role: roleEnum, lea_id: uuid.or(z.literal("")), cluster_code: z.string().regex(/^\d{2}$/).or(z.literal("")), return_to: z.string().startsWith("/app") });
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/users", undefined, "Choose a role and, where required, an LEA or cluster.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("role_grants").insert({ user_id: d.user_id, role: d.role, lea_id: d.lea_id || null, cluster_code: d.cluster_code || null, granted_by: user.id });
  back(d.return_to, error ? undefined : "Role added.", error ? explain(error.message) : undefined);
}

export async function revokeGrant(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ id: uuid, return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.from("role_grants").update({ revoked_at: new Date().toISOString(), revoked_by: user.id }).eq("id", parsed.data.id).is("revoked_at", null);
  back(parsed.data.return_to, error ? undefined : "Role removed.", error ? explain(error.message) : undefined);
}

export async function setAccountStatus(formData: FormData) {
  const admin = await requireRole("state_admin");
  const parsed = z.object({ user_id: uuid, status: z.enum(["active", "deactivated"]), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/users");
  const { user_id, status, return_to } = parsed.data;
  if (user_id === admin.id) back(return_to, undefined, "You cannot deactivate your own account.");
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("profiles")
    .update(status === "deactivated" ? { status, deactivated_at: new Date().toISOString(), deactivated_by: admin.id } : { status, deactivated_at: null, deactivated_by: null })
    .eq("id", user_id);
  if (error) back(return_to, undefined, explain(error.message));
  // The database already refuses every read for a deactivated profile. Banning the
  // auth user also invalidates refresh tokens so the session cannot continue at all.
  try {
    const adminClient = createAdminClient();
    await adminClient.auth.admin.updateUserById(user_id, { ban_duration: status === "deactivated" ? "876000h" : "none" });
    if (status === "deactivated") await adminClient.auth.admin.signOut(user_id, "global").catch(() => undefined);
  } catch {
    back(return_to, "Account status saved. The sign-in ban could not be applied because the server key is not configured; the database already blocks the account.");
  }
  back(return_to, status === "deactivated" ? "Account deactivated. Access ended immediately." : "Account reactivated.");
}

// ---------------------------------------------------------------------------
// Settings: school years, holidays, catalog, pairings
// ---------------------------------------------------------------------------
export async function saveSchoolYear(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ label: z.string().regex(/^\d{4}-\d{4}$/), starts_on: z.string().date(), ends_on: z.string().date(), is_current: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/settings", undefined, "Enter the label as 2027-2028 and both dates.");
  const supabase = await createUserClient();
  if (parsed.data.is_current) await supabase.from("school_years").update({ is_current: false }).eq("is_current", true);
  const { error } = await supabase.from("school_years").upsert({ label: parsed.data.label, starts_on: parsed.data.starts_on, ends_on: parsed.data.ends_on, is_current: !!parsed.data.is_current }, { onConflict: "label" });
  back("/app/admin/settings", error ? undefined : "School year saved.", error ? explain(error.message) : undefined);
}

export async function saveHoliday(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ holiday_on: z.string().date(), name: z.string().trim().min(2).max(80), scope: z.enum(["state", "federal"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/settings", undefined, "Enter a date and a name.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("holidays").upsert(parsed.data, { onConflict: "holiday_on,name" });
  back("/app/admin/settings", error ? undefined : "Holiday saved.", error ? explain(error.message) : undefined);
}

export async function saveCluster(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ code: z.string().regex(/^\d{2}$/), name: z.string().trim().min(2).max(80) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/catalog", undefined, "Cluster code is two digits.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("clusters").upsert({ ...parsed.data, sort: Number(parsed.data.code) }, { onConflict: "code" });
  back("/app/admin/catalog", error ? undefined : "Cluster saved.", error ? explain(error.message) : undefined);
}

export async function saveProgram(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z
    .object({ code: z.string().regex(/^\d{1,3}$/), name: z.string().trim().min(2).max(120), cluster_code: z.string().regex(/^\d{2}$/), level: z.enum(["secondary", "middle"]), is_coop: z.enum(["on"]).optional(), active: z.enum(["on"]).optional() })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/catalog", undefined, "Check the program code, name, and cluster.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("program_catalog").upsert({ code: parsed.data.code, name: parsed.data.name, cluster_code: parsed.data.cluster_code, level: parsed.data.level, is_coop: !!parsed.data.is_coop, active: !!parsed.data.active }, { onConflict: "code" });
  back("/app/admin/catalog", error ? undefined : "Program saved.", error ? explain(error.message) : undefined);
}

export async function savePairing(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ person_a: uuid, person_b: uuid, reason: z.string().trim().min(2).max(200), ends_on: z.string().date().or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/settings", undefined, "Choose two different people and give a reason.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("staff_pairings").insert({ person_a: parsed.data.person_a, person_b: parsed.data.person_b, reason: parsed.data.reason, ends_on: parsed.data.ends_on || null, created_by: user.id });
  back("/app/admin/settings", error ? undefined : "Pairing saved.", error ? explain(error.message) : undefined);
}

export async function endPairing(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/settings");
  const supabase = await createUserClient();
  const { error } = await supabase.from("staff_pairings").update({ ends_on: new Date().toISOString().slice(0, 10) }).eq("id", parsed.data.id);
  back("/app/admin/settings", error ? undefined : "Pairing ended.", error ? explain(error.message) : undefined);
}

export async function saveRetention(formData: FormData) {
  const user = await requireRole("state_admin");
  const supabase = await createUserClient();
  for (const [key, raw] of formData.entries()) {
    const m = /^years:([a-z_]+)$/.exec(key);
    if (!m) continue;
    const years = Number(raw);
    if (!Number.isInteger(years) || years < 1 || years > 50) back("/app/admin/settings", undefined, "Retention years must be a whole number from 1 to 50.");
    const { error } = await supabase.from("retention_policies").update({ years, updated_by: user.id, updated_at: new Date().toISOString() }).eq("record_class", m[1]!);
    if (error) back("/app/admin/settings", undefined, explain(error.message));
  }
  back("/app/admin/settings", "Retention years saved.");
}
