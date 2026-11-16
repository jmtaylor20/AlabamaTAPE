"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";

/** Reviewer-side actions. Every rule (assignment, lock, meeting, fresh MFA) is enforced by the database; these validate and relay. */

const uuid = z.string().uuid();
const qpi = z.string().regex(/^\d\.\d\.[A-Z]$/);
const returnTo = z.string().startsWith("/app");

function back(path: string, notice?: string, error?: string): never {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  revalidatePath(path);
  redirect(params.toString() ? `${path}?${params}` : path);
}

function explain(message: string) {
  if (message.includes("row-level security")) return "You do not have permission to make that change, or this review is finalized.";
  if (message.includes("violates check constraint")) return "One of the values is not valid.";
  return message.replace(/^.*?:\s*/, "").slice(0, 240) || "The change could not be saved.";
}

export async function saveReviewerScore(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ site_id: uuid, qpi_code: qpi, value: z.enum(["1", "2", "NA"]), na_reason: z.string().max(400).or(z.literal("")), comment: z.string().max(4000).or(z.literal("")), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Choose 1, 2, or N/A.");
  const d = parsed.data;
  if (d.value === "NA" && !d.na_reason.trim()) back(d.return_to, undefined, `N/A on ${d.qpi_code} needs a reason.`);
  if (d.value === "1" && !d.comment.trim()) back(d.return_to, undefined, `A Level 1 on ${d.qpi_code} needs a comment; it becomes the finding text.`);
  const supabase = await createUserClient();
  const { error } = await supabase.from("score_entries").insert({ site_id: d.site_id, qpi_code: d.qpi_code, scorer_role: "reviewer", value: d.value, na_reason: d.value === "NA" ? d.na_reason : null, comment: d.comment || null, author_id: user.id });
  back(d.return_to, error ? undefined : `${d.qpi_code} scored.`, error ? explain(error.message) : undefined);
}

export async function saveEpicScore(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ site_id: uuid, descriptor_id: uuid, value: z.enum(["met", "not_met", "NA"]), na_reason: z.string().max(400).or(z.literal("")), comment: z.string().max(2000).or(z.literal("")), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Choose Met, Not met, or N/A.");
  const d = parsed.data;
  if (d.value === "NA" && !d.na_reason.trim()) back(d.return_to, undefined, "N/A needs a reason.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("epic_scores").insert({ site_id: d.site_id, descriptor_id: d.descriptor_id, value: d.value, na_reason: d.value === "NA" ? d.na_reason : null, comment: d.comment || null, author_id: user.id });
  back(d.return_to, error ? undefined : "EPIC descriptor saved.", error ? explain(error.message) : undefined);
}

export async function saveSectionComment(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ site_id: uuid, section_code: z.string().regex(/^\d\.\d$/), author_role: z.enum(["director", "reviewer"]), body: z.string().max(4000), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"));
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("section_comments").upsert({ site_id: d.site_id, section_code: d.section_code, author_role: d.author_role, body: d.body, author_id: user.id, updated_at: new Date().toISOString() }, { onConflict: "site_id,section_code,author_role" });
  back(d.return_to, error ? undefined : "Section comment saved.", error ? explain(error.message) : undefined);
}

export async function saveAuditSample(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ site_id: uuid, qpi_code: qpi, kind: z.enum(["assurance", "safety_exam", "ctip", "training_agreement", "other"]), items_sampled: z.coerce.number().int().min(0), items_passed: z.coerce.number().int().min(0), notes: z.string().max(1000).or(z.literal("")), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Give whole-number counts.");
  const d = parsed.data;
  if (d.items_passed > d.items_sampled) back(d.return_to, undefined, "Passed cannot exceed sampled.");
  const supabase = await createUserClient();
  const { error } = await supabase.from("audit_samples").insert({ site_id: d.site_id, qpi_code: d.qpi_code, kind: d.kind, items_sampled: d.items_sampled, items_passed: d.items_passed, notes: d.notes || null, author_id: user.id });
  back(d.return_to, error ? undefined : "Audit sample recorded. Counts only; never names.", error ? explain(error.message) : undefined);
}

export async function deleteAuditSample(formData: FormData) {
  await requireUser();
  const parsed = z.object({ id: uuid, return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.from("audit_samples").delete().eq("id", parsed.data.id);
  back(parsed.data.return_to, error ? undefined : "Audit sample removed.", error ? explain(error.message) : undefined);
}

/** Called by the onsite checklist, which queues changes while offline and replays them. */
export async function saveOnsiteCheck(input: { siteId: string; subitemId: string; state: "met" | "not_met" | "NA"; note?: string; capturedAt: string }): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const parsed = z.object({ siteId: uuid, subitemId: uuid, state: z.enum(["met", "not_met", "NA"]), note: z.string().max(500).optional(), capturedAt: z.string().datetime() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Bad input." };
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("onsite_checks").upsert({ site_id: d.siteId, subitem_id: d.subitemId, state: d.state, note: d.note || null, captured_at: d.capturedAt, synced_at: new Date().toISOString(), author_id: user.id }, { onConflict: "site_id,subitem_id" });
  return error ? { ok: false, error: explain(error.message) } : { ok: true };
}

export async function saveDeskAudit(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ site_id: uuid, initial_findings: z.string().max(8000), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"));
  const d = parsed.data;
  const supabase = await createUserClient();
  const { data: existing } = await supabase.from("desk_audits").select("id, sent_at").eq("site_id", d.site_id).maybeSingle();
  if (existing?.sent_at) back(d.return_to, undefined, "The desk audit was already sent.");
  const { error } = existing
    ? await supabase.from("desk_audits").update({ initial_findings: d.initial_findings, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : await supabase.from("desk_audits").insert({ site_id: d.site_id, initial_findings: d.initial_findings, author_id: user.id });
  back(d.return_to, error ? undefined : "Desk audit saved as a draft.", error ? explain(error.message) : undefined);
}

export async function sendDeskAudit(formData: FormData) {
  await requireUser();
  const parsed = z.object({ site_id: uuid, return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("send_desk_audit", { p_site: parsed.data.site_id });
  back(parsed.data.return_to, error ? undefined : "Desk audit sent. The Director can read it now; the email draft arrives with the communications phase.", error ? explain(error.message) : undefined);
}

export async function saveConsistencyMeeting(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ lea_review_id: uuid, held_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), attendees: z.string().trim().min(2).max(1000), notes: z.string().max(4000).or(z.literal("")), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Give the date and who attended.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("consistency_meetings").insert({ lea_review_id: d.lea_review_id, held_on: d.held_on, attendees: d.attendees, notes: d.notes || null, recorded_by: user.id });
  back(d.return_to, error ? undefined : "Consistency meeting recorded.", error ? explain(error.message) : undefined);
}

export async function saveFinding(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ id: uuid.or(z.literal("")), site_id: uuid, qpi_code: qpi, teacher_id: uuid.or(z.literal("")), body: z.string().trim().min(2).max(4000), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "A finding needs an indicator and text.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = d.id
    ? await supabase.from("findings").update({ body: d.body, teacher_id: d.teacher_id || null, updated_at: new Date().toISOString() }).eq("id", d.id)
    : await supabase.from("findings").insert({ site_id: d.site_id, qpi_code: d.qpi_code, teacher_id: d.teacher_id || null, body: d.body, created_by: user.id });
  back(d.return_to, error ? undefined : "Finding saved.", error ? explain(error.message) : undefined);
}

export async function clearFinding(formData: FormData) {
  await requireUser();
  const parsed = z.object({ id: uuid, note: z.string().trim().min(2).max(2000), file_id: uuid.or(z.literal("")), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Say what evidence cleared the finding.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("clear_finding", { p_finding: parsed.data.id, p_note: parsed.data.note, p_file: parsed.data.file_id || null });
  back(parsed.data.return_to, error ? undefined : "Finding cleared.", error ? explain(error.message) : undefined);
}

export async function finalizeReview(formData: FormData) {
  await requireUser();
  const parsed = z.object({ program_review_id: uuid, return_to: returnTo, attest: z.literal("on") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the attestation box to finalize.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("finalize_program_review", { p_pr: parsed.data.program_review_id });
  if (error && /authenticator/i.test(error.message)) redirect(`/app/step-up?next=${encodeURIComponent(parsed.data.return_to)}`);
  back(parsed.data.return_to, error ? undefined : "Review finalized. Scores and findings are locked.", error ? explain(error.message) : undefined);
}

export async function reopenReview(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ program_review_id: uuid, reason: z.string().trim().min(3).max(400), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "A reason is required to reopen.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("reopen_program_review", { p_pr: parsed.data.program_review_id, p_reason: parsed.data.reason });
  back(parsed.data.return_to, error ? undefined : "Review reopened. The Director and reviewers are listed to be informed.", error ? explain(error.message) : undefined);
}
