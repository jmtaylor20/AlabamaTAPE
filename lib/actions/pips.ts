"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";

/** Program Improvement Plan actions. The database enforces who may write and whether the PIP is open. */

const uuid = z.string().uuid();
const returnTo = z.string().startsWith("/app");
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function back(path: string, notice?: string, error?: string): never {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  revalidatePath(path);
  redirect(params.toString() ? `${path}?${params}` : path);
}

function explain(message: string) {
  if (message.includes("row-level security")) return "You do not have permission to make that change, or this PIP is closed.";
  if (message.includes("violates check constraint")) return "One of the values is not valid.";
  return message.replace(/^.*?:\s*/, "").slice(0, 240) || "The change could not be saved.";
}

export async function createPip(formData: FormData) {
  await requireUser();
  const parsed = z.object({ program_review_id: uuid, return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("create_pip", { p_pr: parsed.data.program_review_id });
  back(parsed.data.return_to, error ? undefined : "PIP created with one goal per open finding. Write the action steps with the teacher.", error ? explain(error.message) : undefined);
}

export async function concludeReview(formData: FormData) {
  await requireUser();
  const parsed = z.object({ program_review_id: uuid, return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("conclude_program_review", { p_pr: parsed.data.program_review_id });
  back(parsed.data.return_to, error ? undefined : "Review concluded.", error ? explain(error.message) : undefined);
}

export async function saveGoals(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ pip_id: uuid, return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { data: goals } = await supabase.from("pip_goals").select("id").eq("pip_id", parsed.data.pip_id);
  for (const g of goals ?? []) {
    const steps = String(formData.get(`steps:${g.id}`) ?? "").slice(0, 4000);
    const status = String(formData.get(`status:${g.id}`) ?? "");
    const date = String(formData.get(`date:${g.id}`) ?? "");
    if (!["", "ten_days", "one_year", "not_complete"].includes(status)) continue;
    const { error } = await supabase.from("pip_goals").update({ action_steps: steps, status: status || null, date_accomplished: dateStr.safeParse(date).success ? date : null, updated_at: new Date().toISOString() }).eq("id", g.id);
    if (error) back(parsed.data.return_to, undefined, explain(error.message));
  }
  const extraQpi = String(formData.get("new_qpi") ?? "");
  const extraSteps = String(formData.get("new_steps") ?? "").trim();
  if (/^\d\.\d\.[A-Z]$/.test(extraQpi) && extraSteps) {
    const { error } = await supabase.from("pip_goals").insert({ pip_id: parsed.data.pip_id, qpi_code: extraQpi, action_steps: extraSteps.slice(0, 4000), sort: (goals?.length ?? 0) + 1, created_by: user.id });
    if (error) back(parsed.data.return_to, undefined, explain(error.message));
  }
  back(parsed.data.return_to, "Goals saved.");
}

export async function saveProgress(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ pip_id: uuid, month: z.coerce.number().int().min(1).max(12), body: z.string().trim().min(2).max(4000), progress_lacking: z.enum(["on"]).optional(), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Pick the month and write what happened.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("pip_progress").upsert({ pip_id: d.pip_id, month: d.month, body: d.body, progress_lacking: !!d.progress_lacking, entered_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "pip_id,month" });
  back(d.return_to, error ? undefined : `Month ${d.month} progress saved.`, error ? explain(error.message) : undefined);
}

export async function addPipNote(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ pip_id: uuid, goal_id: uuid.or(z.literal("")), author_role: z.enum(["director", "teacher", "reviewer"]), body: z.string().trim().min(2).max(4000), evidence_file_id: uuid.or(z.literal("")), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Write a note.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { error } = await supabase.from("pip_notes").insert({ pip_id: d.pip_id, goal_id: d.goal_id || null, author_role: d.author_role, body: d.body, evidence_file_id: d.evidence_file_id || null, author_id: user.id });
  back(d.return_to, error ? undefined : "Note added.", error ? explain(error.message) : undefined);
}

export async function closePip(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ pip_id: uuid, note: z.string().trim().min(2).max(2000), return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "A closing note is required.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("close_pip", { p_pip: parsed.data.pip_id, p_note: parsed.data.note });
  back(parsed.data.return_to, error ? undefined : "PIP closed.", error ? explain(error.message) : undefined);
}

export async function runEscalations(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ return_to: returnTo }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app/pips");
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("run_pip_escalations");
  back(parsed.data.return_to, error ? undefined : `Escalation check complete: ${data ?? 0} new escalation${data === 1 ? "" : "s"} recorded.`, error ? explain(error.message) : undefined);
}
