"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { beginUpload, completeUpload } from "@/lib/actions/evidence";
import { ACCEPT, MAX_FILE_BYTES, fmtBytes } from "@/lib/evidence/rules";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Alert, Button, Field, Input, Select } from "@/lib/ui";

type Props = {
  declaredProgramId: string;
  qpis: { code: string; title: string }[];
  teachers: { id: string; display_name: string }[];
  categories?: { value: string; label: string }[];
  yearLabels?: string[];
  compact?: boolean;
};

type Stage = "idle" | "preparing" | "uploading" | "scanning" | "done" | "error";

/** Upload one file: reserve a slot, send the bytes straight to private storage, then ask the server to scan. */
export function EvidenceUpload({ declaredProgramId, qpis, teachers, categories, yearLabels, compact }: Props) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("idle");
  const [message, setMessage] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(categories?.[0]?.value ?? "evidence");
  const formId = `upload-${declaredProgramId.slice(0, 8)}`;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    const form = new FormData(e.currentTarget);
    setStage("preparing");
    setMessage("Checking the file...");
    const begin = await beginUpload({
      declaredProgramId, name: file.name, size: file.size, contentType: file.type, category,
      formYearLabel: String(form.get("form_year_label") || "") || undefined, teacherId: String(form.get("teacher_id") || "") || undefined,
      note: String(form.get("note") || "") || undefined, qpiCodes: form.getAll("qpi_codes").map(String),
    });
    if (!begin.ok) { setStage("error"); setMessage(begin.error); return; }
    setStage("uploading");
    setMessage(`Uploading ${fmtBytes(file.size)}...`);
    const supabase = createBrowserSupabase();
    const { error } = await supabase.storage.from("evidence").uploadToSignedUrl(begin.path, begin.token, file, { contentType: begin.contentType, upsert: false });
    if (error) { setStage("error"); setMessage(`The upload did not complete: ${error.message}`); return; }
    setStage("scanning");
    setMessage("Scanning...");
    const done = await completeUpload(begin.fileId);
    if (done.ok) { setStage("done"); setMessage("Uploaded and scanned clean."); }
    else { setStage("error"); setMessage(done.status === "infected" ? `Rejected by the scanner: ${done.detail ?? "the file failed the check"}. It was not kept.` : `The scan could not finish (${done.detail ?? done.status}). The file stays locked until an administrator rescans it.`); }
    setFile(null);
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }

  const busy = stage === "preparing" || stage === "uploading" || stage === "scanning";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" aria-describedby={`${formId}-warning`}>
      <Alert tone="warning" title="Do not upload student information">
        <span id={`${formId}-warning`}>Evidence must not contain student names, ID numbers, grades, or other personally identifiable student information. Redact rosters and samples before uploading. Reviewers can quarantine files that contain student data.</span>
      </Alert>
      <Field id={`${formId}-file`} label="File" hint={`PDF, Word, Excel, PowerPoint, images, or common video, up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`}>
        <Input id={`${formId}-file`} name="file" type="file" accept={ACCEPT} required className="py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      {categories && categories.length > 1 && (
        <Field id={`${formId}-category`} label="What is this">
          <Select id={`${formId}-category`} name="category" value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
        </Field>
      )}
      {category === "form_141_scan" && yearLabels && (
        <Field id={`${formId}-year`} label="School year of this Form 14-1"><Select id={`${formId}-year`} name="form_year_label">{yearLabels.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
      )}
      {category === "evidence" && !compact && (
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Which quality indicators does this file support?</legend>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {qpis.map((q) => <label key={q.code} className="flex items-start gap-2 text-sm"><input type="checkbox" name="qpi_codes" value={q.code} className="mt-0.5 h-5 w-5" /><span><span className="font-mono text-xs">{q.code}</span> {q.title}</span></label>)}
          </div>
        </fieldset>
      )}
      {teachers.length > 1 && (
        <Field id={`${formId}-teacher`} label="Teacher (optional)" hint="Tag the file to one teacher when the program has more than one."><Select id={`${formId}-teacher`} name="teacher_id" defaultValue=""><option value="">Whole program</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select></Field>
      )}
      <Field id={`${formId}-note`} label="Note (optional)"><Input id={`${formId}-note`} name="note" maxLength={500} /></Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !file}>{busy ? message : "Upload"}</Button>
        {!busy && message && <span role="status" className={`text-sm ${stage === "error" ? "text-danger" : "text-success"}`}>{message}</span>}
      </div>
    </form>
  );
}
