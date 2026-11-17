"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth/session";
import { sendEmail } from "@/lib/email/send";
import { createUserClient } from "@/lib/supabase/server";

/** Templates, drafts, approval, and sending. The database generates drafts and enforces the embargo and the staff-only rule. */

const uuid = z.string().uuid();
const returnTo = z.string().startsWith("/app");
const STEPS = ["check_in", "declaration_window", "notification", "evidence_reminder", "desk_audit", "conclusion", "pip_followup", "pip_escalation", "scope_change", "reviewer_assignment"] as const;
const emailList = z.string().transform((s) => s.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)).pipe(z.array(z.string().email()).max(60));

function back(path: string, notice?: string, error?: string): never {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  revalidatePath(path);
  redirect(params.toString() ? `${path}?${params}` : path);
}

function explain(message: string) {
  if (message.includes("row-level security")) return "You do not have permission to make that change.";
  return message.replace(/^.*?:\s*/, "").slice(0, 300) || "The change could not be saved.";
}

export async function generateDraft(formData: FormData) {
  await requireUser();
  const parsed = z.object({ step: z.enum(STEPS), lea_review_id: uuid, program_review_id: uuid.or(z.literal("")).optional(), pip_id: uuid.or(z.literal("")).optional(), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Choose a message to draft.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("generate_draft", { p_step: d.step, p_lea_review: d.lea_review_id, p_program_review: d.program_review_id || null, p_pip: d.pip_id || null });
  if (error) back(d.return_to, undefined, error.message.includes("before the notification is released") ? "That message cannot go to the district before the notification is released." : explain(error.message));
  redirect(`/app/drafts/${data}`);
}

export async function updateDraft(formData: FormData) {
  await requireUser();
  const parsed = z.object({ id: uuid, subject: z.string().trim().min(2).max(300), body: z.string().min(2).max(20000), to_list: emailList, cc_list: emailList }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(`/app/drafts/${formData.get("id")}`, undefined, "Check the subject, body, and addresses.");
  const d = parsed.data;
  const path = `/app/drafts/${d.id}`;
  const supabase = await createUserClient();
  const { error, count } = await supabase.from("email_drafts").update({ subject: d.subject, body: d.body, to_list: d.to_list, cc_list: d.cc_list.filter((e) => !d.to_list.includes(e)) }, { count: "exact" }).eq("id", d.id);
  back(path, error || !count ? undefined : "Draft saved.", error ? (error.message.includes("staff-only") ? "A staff-only message cannot include a district address." : error.message.includes("embargoed") ? "That text names something the district may not see before release." : explain(error.message)) : !count ? "Only an unapproved draft can be edited." : undefined);
}

export async function approveDraft(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/drafts");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("approve_draft", { p_draft: parsed.data.id });
  back(`/app/drafts/${parsed.data.id}`, error ? undefined : "Approved. Send it from here or copy it to Outlook.", error ? explain(error.message) : undefined);
}

export async function sendDraft(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/drafts");
  const path = `/app/drafts/${parsed.data.id}`;
  const supabase = await createUserClient();
  const { data: draft } = await supabase.from("email_drafts").select("id, status, subject, body, to_list, cc_list").eq("id", parsed.data.id).maybeSingle();
  if (!draft) back("/app/drafts", undefined, "Draft not found.");
  if (draft.status !== "approved") back(path, undefined, "Approve the draft before sending.");
  const result = await sendEmail({ to: draft.to_list as string[], cc: draft.cc_list as string[], subject: draft.subject, text: draft.body, replyTo: user.email });
  await supabase.rpc("mark_draft_sent", { p_draft: draft.id, p_message_id: result.ok ? result.id : null, p_error: result.ok ? null : result.error });
  back(path, result.ok ? "Sent." : undefined, result.ok ? undefined : result.error);
}

export async function markSentOutside(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ id: uuid }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/drafts");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("mark_draft_sent", { p_draft: parsed.data.id, p_message_id: "sent-from-outlook", p_error: null });
  back(`/app/drafts/${parsed.data.id}`, error ? undefined : "Recorded as sent from Outlook.", error ? explain(error.message) : undefined);
}

export async function discardDraft(formData: FormData) {
  await requireUser();
  const parsed = z.object({ id: uuid, reason: z.string().max(300).or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/drafts");
  const supabase = await createUserClient();
  const { error, count } = await supabase.from("email_drafts").update({ status: "discarded", discard_reason: parsed.data.reason || null }, { count: "exact" }).eq("id", parsed.data.id);
  back("/app/drafts", error || !count ? undefined : "Draft discarded.", error ? explain(error.message) : !count ? "Only an unapproved draft you generated can be discarded." : undefined);
}

export async function saveTemplate(formData: FormData) {
  const user = await requireRole("state_admin");
  const parsed = z.object({ id: uuid, subject: z.string().trim().min(2).max(300), body: z.string().min(2).max(20000), to_roles: z.string(), cc_roles: z.string(), active: z.enum(["on"]).optional() }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/admin/communications", undefined, "Check the subject and body.");
  const d = parsed.data;
  const roles = (s: string) => s.split(/[,\s]+/).map((r) => r.trim()).filter((r) => ["cte_director", "lea_staff", "teachers", "lead_reviewer", "reviewer", "reviewers", "cluster_admin", "state_admin"].includes(r));
  if ([...(d.subject + d.body)].some((ch) => ch.charCodeAt(0) === 0x2013 || ch.charCodeAt(0) === 0x2014)) back("/app/admin/communications", undefined, "Templates may not contain em dashes or en dashes.");
  const supabase = await createUserClient();
  const { data: current } = await supabase.from("email_templates").select("version").eq("id", d.id).maybeSingle();
  const { error } = await supabase.from("email_templates").update({ subject: d.subject, body: d.body, to_roles: roles(d.to_roles), cc_roles: roles(d.cc_roles), active: !!d.active, version: (current?.version ?? 1) + 1, updated_by: user.id, updated_at: new Date().toISOString() }).eq("id", d.id);
  back("/app/admin/communications", error ? undefined : "Template saved as a new version.", error ? explain(error.message) : undefined);
}
