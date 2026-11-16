"use server";

import { createHash, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth/session";
import { BUCKET, scanFile, validateUpload } from "@/lib/evidence/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Evidence, self-scores, credential counts, and Form 14-1. Authorization is
 * the database's job; these actions validate input, talk to storage, and
 * run the scan. The service-role client touches storage and the scan columns
 * only after the user's own client has proven the row is theirs to see.
 */

const uuid = z.string().uuid();

function back(path: string, notice?: string, error?: string): never {
  const params = new URLSearchParams();
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  revalidatePath(path);
  redirect(params.toString() ? `${path}?${params}` : path);
}

function explain(message: string) {
  if (message.includes("row-level security")) return "You do not have permission to make that change.";
  if (message.includes("violates check constraint")) return "One of the values is not valid.";
  return message.replace(/^.*?:\s*/, "").slice(0, 200) || "The change could not be saved.";
}

export type BeginUploadResult = { ok: true; fileId: string; path: string; token: string; contentType: string } | { ok: false; error: string };

/** Step 1: validate, reserve a random storage key, insert the pending row (policy checked), issue a one-time signed upload slot. */
export async function beginUpload(input: { declaredProgramId: string; name: string; size: number; contentType: string; category: string; formYearLabel?: string; teacherId?: string; note?: string; qpiCodes: string[] }): Promise<BeginUploadResult> {
  const user = await requireUser();
  const parsed = z.object({
    declaredProgramId: uuid, name: z.string().min(1).max(200), size: z.number().int().positive(), contentType: z.string().max(120),
    category: z.enum(["evidence", "form_141_scan", "spp_report", "credential_report"]), formYearLabel: z.string().regex(/^\d{4}-\d{4}$/).optional(), teacherId: uuid.optional(),
    note: z.string().max(500).optional(), qpiCodes: z.array(z.string().regex(/^\d\.\d\.[A-Z]$/)).max(30),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the file and the details." };
  const d = parsed.data;
  const supabase = await createUserClient();
  const { data: allowed } = await supabase.rpc("consume_rate_limit", { p_key: `upload:${user.id}`, p_max: 60, p_window_seconds: 600 });
  if (allowed === false) return { ok: false, error: "Too many uploads in a short time. Wait a few minutes and try again." };
  const { data: dp } = await supabase.from("declared_programs").select("id, lea_id, school_year_id, program_code, home_school_id, leas(system_code)").eq("id", d.declaredProgramId).maybeSingle();
  if (!dp) return { ok: false, error: "Program not found." };
  const { data: used } = await supabase.from("evidence_files").select("size_bytes").eq("declared_program_id", dp.id).is("removed_at", null);
  const alreadyUsedBytes = (used ?? []).reduce((n, f) => n + Number(f.size_bytes), 0);
  const check = validateUpload({ name: d.name, size: d.size, contentType: d.contentType, alreadyUsedBytes });
  if (!check.ok) return { ok: false, error: check.reason };
  const ext = d.name.toLowerCase().split(".").pop();
  const fileId = randomUUID();
  const path = `${(dp.leas as unknown as { system_code: string } | null)?.system_code ?? "lea"}/${dp.school_year_id}/${dp.id}/${fileId}.${ext}`;
  const { error } = await supabase.from("evidence_files").insert({
    id: fileId, lea_id: dp.lea_id, school_year_id: dp.school_year_id, declared_program_id: dp.id, program_code: dp.program_code, school_id: dp.home_school_id,
    teacher_id: d.teacherId ?? null, category: d.category, form_year_label: d.formYearLabel ?? null, storage_key: path, original_name: d.name, content_type: check.contentType, size_bytes: d.size, note: d.note || null, uploaded_by: user.id,
  });
  if (error) return { ok: false, error: explain(error.message) };
  if (d.qpiCodes.length) await supabase.from("evidence_qpi_links").insert(d.qpiCodes.map((code) => ({ file_id: fileId, qpi_code: code, created_by: user.id })));
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    await supabase.rpc("remove_evidence", { p_file: fileId, p_reason: "storage not configured" });
    return { ok: false, error: "File storage is not configured on this server yet. Ask the TAPE coordinator to finish the setup." };
  }
  const { data: slot, error: slotError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (slotError || !slot) {
    await admin.from("evidence_files").update({ scan_status: "failed", scan_detail: "could not open an upload slot", removed_at: new Date().toISOString() }).eq("id", fileId);
    return { ok: false, error: "Storage is not available right now. Try again in a moment." };
  }
  return { ok: true, fileId, path: slot.path, token: slot.token, contentType: check.contentType };
}

/** Step 2: the bytes are in storage. Hash and scan them before the file can be opened by anyone. */
export async function completeUpload(fileId: string): Promise<{ ok: boolean; status: string; detail?: string }> {
  const user = await requireUser();
  if (!uuid.safeParse(fileId).success) return { ok: false, status: "failed", detail: "bad id" };
  const supabase = await createUserClient();
  const { data: file } = await supabase.from("evidence_files").select("id, storage_key, original_name, content_type, size_bytes, uploaded_by, scan_status, lea_id").eq("id", fileId).maybeSingle();
  if (!file || file.uploaded_by !== user.id || file.scan_status !== "pending") return { ok: false, status: "failed", detail: "not your pending upload" };
  const admin = createAdminClient();
  const { data: blob, error } = await admin.storage.from(BUCKET).download(file.storage_key);
  if (error || !blob) {
    await admin.from("evidence_files").update({ scan_status: "failed", scanner: "download", scan_detail: "the upload did not arrive", scanned_at: new Date().toISOString() }).eq("id", fileId);
    return { ok: false, status: "failed", detail: "The upload did not arrive. Try again." };
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const result = buf.length > Number(file.size_bytes) * 1.05 + 1024 ? { status: "infected" as const, scanner: "basic", detail: "size does not match the declared size" } : await scanFile(buf, file.original_name, file.content_type);
  await admin.from("evidence_files").update({ sha256, size_bytes: buf.length, scan_status: result.status, scanner: result.scanner, scan_detail: result.detail ?? null, scanned_at: new Date().toISOString() }).eq("id", fileId);
  if (result.status === "infected") await admin.storage.from(BUCKET).remove([file.storage_key]);
  await supabase.rpc("log_event", { p_action: `evidence.scan_${result.status}`, p_entity_type: "evidence_files", p_entity_id: fileId, p_lea_id: file.lea_id, p_meta: { scanner: result.scanner, detail: result.detail ?? null } });
  return { ok: result.status === "clean", status: result.status, detail: result.detail };
}

export async function rescanEvidence(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ file_id: uuid, return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { data: file } = await supabase.from("evidence_files").select("id, storage_key, original_name, content_type, lea_id").eq("id", parsed.data.file_id).maybeSingle();
  if (!file) back(parsed.data.return_to, undefined, "File not found.");
  const admin = createAdminClient();
  const { data: blob } = await admin.storage.from(BUCKET).download(file.storage_key);
  if (!blob) back(parsed.data.return_to, undefined, "The file is not in storage.");
  const buf = new Uint8Array(await blob.arrayBuffer());
  const result = await scanFile(buf, file.original_name, file.content_type);
  await admin.from("evidence_files").update({ scan_status: result.status, scanner: result.scanner, scan_detail: result.detail ?? null, scanned_at: new Date().toISOString(), sha256: createHash("sha256").update(buf).digest("hex") }).eq("id", file.id);
  back(parsed.data.return_to, `Scan result: ${result.status}.`);
}

export async function setEvidenceLinks(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ file_id: uuid, return_to: z.string().startsWith("/app"), note: z.string().max(500).or(z.literal("")), teacher_id: uuid.or(z.literal("")) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const codes = (formData.getAll("qpi_codes") as string[]).filter((c) => /^\d\.\d\.[A-Z]$/.test(c));
  const supabase = await createUserClient();
  const { data: existing } = await supabase.from("evidence_qpi_links").select("qpi_code").eq("file_id", parsed.data.file_id);
  const have = new Set((existing ?? []).map((e) => e.qpi_code));
  const add = codes.filter((c) => !have.has(c));
  const drop = [...have].filter((c) => !codes.includes(c));
  if (add.length) {
    const { error } = await supabase.from("evidence_qpi_links").insert(add.map((qpi_code) => ({ file_id: parsed.data.file_id, qpi_code, created_by: user.id })));
    if (error) back(parsed.data.return_to, undefined, explain(error.message));
  }
  if (drop.length) await supabase.from("evidence_qpi_links").delete().eq("file_id", parsed.data.file_id).in("qpi_code", drop);
  if (user.isStateAdmin) await supabase.from("evidence_files").update({ note: parsed.data.note || null, teacher_id: parsed.data.teacher_id || null }).eq("id", parsed.data.file_id);
  back(parsed.data.return_to, "Evidence links saved.");
}

export async function removeEvidence(formData: FormData) {
  await requireUser();
  const parsed = z.object({ file_id: uuid, reason: z.string().max(300).or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("remove_evidence", { p_file: parsed.data.file_id, p_reason: parsed.data.reason || null });
  back(parsed.data.return_to, error ? undefined : "File removed. It stays in the record for the State Admin.", error ? explain(error.message) : undefined);
}

export async function quarantineEvidence(formData: FormData) {
  await requireUser();
  const parsed = z.object({ file_id: uuid, reason: z.string().trim().min(2).max(300), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Give a reason for the quarantine.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("quarantine_evidence", { p_file: parsed.data.file_id, p_reason: parsed.data.reason });
  back(parsed.data.return_to, error ? undefined : "File quarantined. District accounts can no longer see it.", error ? explain(error.message) : undefined);
}

export async function releaseQuarantine(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ file_id: uuid, reason: z.string().max(300).or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("release_quarantine", { p_file: parsed.data.file_id, p_reason: parsed.data.reason || null });
  back(parsed.data.return_to, error ? undefined : "Quarantine lifted.", error ? explain(error.message) : undefined);
}

// ---------------------------------------------------------------------------
// Director self-scores
// ---------------------------------------------------------------------------
export async function saveSelfScore(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ site_id: uuid, qpi_code: z.string().regex(/^\d\.\d\.[A-Z]$/), value: z.enum(["1", "2", "NA"]), na_reason: z.string().max(400).or(z.literal("")), comment: z.string().max(2000).or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Choose 1, 2, or N/A.");
  const d = parsed.data;
  if (d.value === "NA" && !d.na_reason.trim()) back(d.return_to, undefined, `N/A on ${d.qpi_code} needs a reason.`);
  const supabase = await createUserClient();
  const { error } = await supabase.from("score_entries").insert({ site_id: d.site_id, qpi_code: d.qpi_code, scorer_role: "director", value: d.value, na_reason: d.value === "NA" ? d.na_reason : null, comment: d.comment || null, author_id: user.id });
  back(d.return_to, error ? undefined : `${d.qpi_code} saved.`, error ? (error.message.includes("row-level security") ? "Self-scoring is not open for this program right now." : explain(error.message)) : undefined);
}

export async function submitDirectorScores(formData: FormData) {
  await requireUser();
  const parsed = z.object({ site_id: uuid, return_to: z.string().startsWith("/app"), attest: z.literal("on") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the attestation box to submit.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("submit_director_scores", { p_site: parsed.data.site_id });
  back(parsed.data.return_to, error ? undefined : "Evidence and self-scores submitted. Thank you.", error ? explain(error.message) : undefined);
}

export async function reopenDirectorScores(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ site_id: uuid, reason: z.string().trim().min(2).max(400), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "A reason is required.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("reopen_director_scores", { p_site: parsed.data.site_id, p_reason: parsed.data.reason, p_until: parsed.data.until || null });
  back(parsed.data.return_to, error ? undefined : "Self-scoring reopened.", error ? explain(error.message) : undefined);
}

// ---------------------------------------------------------------------------
// Credential results
// ---------------------------------------------------------------------------
export async function saveCredential(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ id: uuid.or(z.literal("")), declared_program_id: uuid, credential_name: z.string().trim().min(2).max(160), test_takers: z.coerce.number().int().min(0), passers: z.coerce.number().int().min(0), source_file_id: uuid.or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Give the credential a name and whole-number counts.");
  const d = parsed.data;
  if (d.passers > d.test_takers) back(d.return_to, undefined, "Passers cannot exceed test takers.");
  const supabase = await createUserClient();
  const { data: dp } = await supabase.from("declared_programs").select("lea_id, school_year_id").eq("id", d.declared_program_id).maybeSingle();
  if (!dp) back(d.return_to, undefined, "Program not found.");
  const row = { lea_id: dp.lea_id, school_year_id: dp.school_year_id, declared_program_id: d.declared_program_id, credential_name: d.credential_name, test_takers: d.test_takers, passers: d.passers, source_file_id: d.source_file_id || null, entered_by: user.id, updated_at: new Date().toISOString() };
  const { error } = d.id ? await supabase.from("credential_results").update(row).eq("id", d.id) : await supabase.from("credential_results").insert(row);
  back(d.return_to, error ? undefined : "Credential counts saved.", error ? explain(error.message) : undefined);
}

export async function deleteCredential(formData: FormData) {
  await requireUser();
  const parsed = z.object({ id: uuid, return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back("/app");
  const supabase = await createUserClient();
  const { error } = await supabase.from("credential_results").delete().eq("id", parsed.data.id);
  back(parsed.data.return_to, error ? undefined : "Credential row deleted.", error ? explain(error.message) : undefined);
}

// ---------------------------------------------------------------------------
// Form 14-1
// ---------------------------------------------------------------------------
export async function saveForm141(formData: FormData) {
  const user = await requireUser();
  const parsed = z.object({ form_id: uuid.or(z.literal("")), declared_program_id: uuid, ta_requested_level1: z.enum(["on"]).optional(), ta_requested_new_teacher: z.enum(["on"]).optional(), comments: z.string().max(4000).or(z.literal("")), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the form.");
  const d = parsed.data;
  const supabase = await createUserClient();
  const { data: dp } = await supabase.from("declared_programs").select("lea_id, school_year_id").eq("id", d.declared_program_id).maybeSingle();
  if (!dp) back(d.return_to, undefined, "Program not found.");
  let formId = d.form_id;
  const fields = { ta_requested_level1: !!d.ta_requested_level1, ta_requested_new_teacher: !!d.ta_requested_new_teacher, comments: d.comments || null, completed_by: user.id, updated_at: new Date().toISOString() };
  if (formId) {
    const { error, count } = await supabase.from("form_141").update(fields, { count: "exact" }).eq("id", formId);
    if (error || !count) back(d.return_to, undefined, error ? explain(error.message) : "This form is submitted and can no longer be changed.");
  } else {
    const { data: version } = await supabase.from("instrument_versions").select("id").eq("school_year_id", dp.school_year_id).eq("status", "published").order("published_at", { ascending: false }).limit(1).maybeSingle();
    formId = randomUUID();
    const { error } = await supabase.from("form_141").insert({ id: formId, lea_id: dp.lea_id, school_year_id: dp.school_year_id, declared_program_id: d.declared_program_id, instrument_version_id: version?.id ?? null, ...fields });
    if (error) back(d.return_to, undefined, explain(error.message));
  }
  const items: { form_id: string; qpi_code: string; score: "1" | "2" | "NA" | null; corrective_action: string | null; updated_by: string; updated_at: string }[] = [];
  for (const [key, raw] of formData.entries()) {
    const m = /^score:(\d\.\d\.[A-Z])$/.exec(key);
    if (!m) continue;
    const code = m[1]!;
    const value = String(raw);
    const action = String(formData.get(`action:${code}`) ?? "").slice(0, 2000);
    if (!["1", "2", "NA", ""].includes(value)) continue;
    items.push({ form_id: formId, qpi_code: code, score: value === "" ? null : (value as "1" | "2" | "NA"), corrective_action: action || null, updated_by: user.id, updated_at: new Date().toISOString() });
  }
  if (items.length) {
    const { error } = await supabase.from("form_141_items").upsert(items, { onConflict: "form_id,qpi_code" });
    if (error) back(d.return_to, undefined, explain(error.message));
  }
  back(d.return_to, "Form 14-1 saved.");
}

export async function submitForm141(formData: FormData) {
  await requireUser();
  const parsed = z.object({ form_id: uuid, return_to: z.string().startsWith("/app"), attest: z.literal("on") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "Check the attestation box to submit.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("submit_form_141", { p_form: parsed.data.form_id });
  back(parsed.data.return_to, error ? undefined : "Form 14-1 submitted.", error ? explain(error.message) : undefined);
}

export async function reopenForm141(formData: FormData) {
  await requireRole("state_admin");
  const parsed = z.object({ form_id: uuid, reason: z.string().trim().min(2).max(400), return_to: z.string().startsWith("/app") }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) back(String(formData.get("return_to") || "/app"), undefined, "A reason is required.");
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("reopen_form_141", { p_form: parsed.data.form_id, p_reason: parsed.data.reason });
  back(parsed.data.return_to, error ? undefined : "Form 14-1 reopened for editing.", error ? explain(error.message) : undefined);
}
