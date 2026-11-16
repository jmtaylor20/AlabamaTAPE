import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Spreadsheet export of a list. Every query runs under the caller's own
 * policies, so an export never holds more than the screen would show, and
 * every export is logged. Leadership gets counts, never text.
 */
const KINDS = ["reviews", "programs", "findings", "pips", "drafts", "calendar", "evidence", "audit", "declarations"] as const;
type Kind = (typeof KINDS)[number];
type ReviewCount = { lea_name: string; program_code: string; program_name: string; cluster_code: string; review_month: number; review_year: number; status: string; released: boolean; finalized: boolean; level2: number; level1: number; na: number; open_findings: number; cleared_findings: number; pip_status: string | null; pip_due: string | null };
type FindingCount = { qpi_code: string; open_count: number; cleared_count: number };

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") return NextResponse.redirect(new URL("/sign-in", req.url));
  const { kind } = await params;
  const k = kind.replace(/\.xlsx$/, "") as Kind;
  if (!KINDS.includes(k)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createUserClient();
  const leadershipOnly = user.roles.has("leadership") && !user.isStateAdmin;
  let columns: string[] = [];
  let rows: unknown[][] = [];

  if (k === "reviews") {
    const { data } = (await supabase.rpc("review_counts")) as { data: ReviewCount[] | null };
    columns = ["System", "Program code", "Program", "Cluster", "Review month", "Review year", "Status", "Released", "Finalized", "Level 2", "Level 1", "N/A", "Open findings", "Cleared findings", "PIP status", "PIP due"];
    rows = (data ?? []).map((r) => [r.lea_name, r.program_code, r.program_name, r.cluster_code, r.review_month, r.review_year, r.status, r.released ? "Yes" : "No", r.finalized ? "Yes" : "No", Number(r.level2), Number(r.level1), Number(r.na), Number(r.open_findings), Number(r.cleared_findings), r.pip_status ?? "", r.pip_due ?? ""]);
  } else if (k === "programs" || k === "declarations") {
    const { data } = await supabase.from("declared_programs").select("program_code, delivery_type, dual_scenario, ase_accredited, vacant, first_year_teacher, epic_requested, status, leas!declared_programs_lea_id_fkey(system_code, name), school_years(label), program_catalog(name, cluster_code), home:schools!declared_programs_home_school_id_fkey(school_code, name), declared_program_teachers(teachers(display_name))").order("program_code");
    columns = ["System code", "System", "School year", "Program code", "Program", "Cluster", "School code", "School", "Teachers", "Delivery", "Dual scenario", "ASE", "Vacant", "First year", "EPIC", "Status"];
    rows = (data ?? []).map((d) => { const l = d.leas as unknown as { system_code: string; name: string } | null; const c = d.program_catalog as unknown as { name: string; cluster_code: string } | null; const s = d.home as unknown as { school_code: string; name: string } | null; return [l?.system_code, l?.name, (d.school_years as unknown as { label: string } | null)?.label, d.program_code, c?.name, c?.cluster_code, s?.school_code ?? "", s?.name ?? "", ((d.declared_program_teachers as unknown as { teachers: { display_name: string } | null }[]) ?? []).map((t) => t.teachers?.display_name).filter(Boolean).join(", "), d.delivery_type, d.dual_scenario ?? "", d.ase_accredited ? "Yes" : "", d.vacant ? "Yes" : "", d.first_year_teacher ? "Yes" : "", d.epic_requested ? "Yes" : "", d.status]; });
  } else if (k === "findings") {
    if (leadershipOnly) {
      const { data } = (await supabase.rpc("finding_counts")) as { data: FindingCount[] | null };
      columns = ["QPI", "Open", "Cleared"];
      rows = (data ?? []).map((r) => [r.qpi_code, Number(r.open_count), Number(r.cleared_count)]);
    } else {
      const { data } = await supabase.from("findings").select("qpi_code, body, status, created_at, cleared_at, clearing_note, program_review_sites(school_name, program_reviews(program_code, program_catalog(name), lea_reviews(leas(name))))").order("created_at");
      columns = ["System", "Program", "School", "QPI", "Finding", "Status", "Created", "Cleared", "Clearing note"];
      rows = (data ?? []).map((f) => { const s = f.program_review_sites as unknown as { school_name: string | null; program_reviews: { program_code: string; program_catalog: { name: string } | null; lea_reviews: { leas: { name: string } | null } | null } | null } | null; return [s?.program_reviews?.lea_reviews?.leas?.name, `${s?.program_reviews?.program_code} ${s?.program_reviews?.program_catalog?.name ?? ""}`, s?.school_name ?? "", f.qpi_code, f.body, f.status, f.created_at, f.cleared_at ?? "", f.clearing_note ?? ""]; });
    }
  } else if (k === "pips") {
    const { data } = await supabase.from("pips").select("status, ten_day_close, starts_on, due_on, closed_at, program_reviews(program_code, program_catalog(name), lea_reviews(leas(name))), pip_goals(status), pip_escalations(month)").order("due_on");
    columns = ["System", "Program", "Status", "Ten-day close", "Started", "Due", "Closed", "Goals", "Goals open", "Escalations"];
    rows = (data ?? []).map((p) => { const pr = p.program_reviews as unknown as { program_code: string; program_catalog: { name: string } | null; lea_reviews: { leas: { name: string } | null } | null } | null; const goals = (p.pip_goals as { status: string | null }[]) ?? []; return [pr?.lea_reviews?.leas?.name, `${pr?.program_code} ${pr?.program_catalog?.name ?? ""}`, p.status, p.ten_day_close, p.starts_on, p.due_on, p.closed_at ?? "", leadershipOnly ? "" : goals.length, leadershipOnly ? "" : goals.filter((g) => !g.status || g.status === "not_complete").length, ((p.pip_escalations as { month: number }[]) ?? []).map((e) => e.month).join(", ")]; });
  } else if (k === "drafts") {
    const { data } = await supabase.from("email_drafts").select("created_at, step_key, audience, status, subject, to_list, cc_list, sent_at, lea_reviews(leas(name))").order("created_at", { ascending: false });
    columns = ["Created", "Step", "Audience", "Status", "System", "Subject", "To", "Cc", "Sent"];
    rows = (data ?? []).map((d) => [d.created_at, d.step_key, d.audience, d.status, (d.lea_reviews as unknown as { leas: { name: string } | null } | null)?.leas?.name, d.subject, (d.to_list as string[]).join("; "), (d.cc_list as string[]).join("; "), d.sent_at ?? ""]);
  } else if (k === "calendar") {
    const { data } = await supabase.from("calendar_items").select("*").order("on_date");
    columns = ["Date", "Milestone", "System", "Review month", "Review year", "Done"];
    rows = (data ?? []).map((i) => [i.on_date, i.kind, i.lea_name, i.review_month, i.review_year, i.done ? "Yes" : ""]);
  } else if (k === "evidence") {
    const { data } = await supabase.from("evidence_files").select("original_name, category, content_type, size_bytes, scan_status, quarantined, removed_at, created_at, program_code, leas!evidence_files_lea_id_fkey(name), evidence_qpi_links(qpi_code)").order("created_at", { ascending: false });
    columns = ["System", "Program code", "File", "Category", "Type", "Bytes", "Scan", "Quarantined", "Removed", "Uploaded", "QPIs"];
    rows = (data ?? []).map((f) => [(f.leas as unknown as { name: string } | null)?.name, f.program_code, f.original_name, f.category, f.content_type, Number(f.size_bytes), f.scan_status, f.quarantined ? "Yes" : "", f.removed_at ?? "", f.created_at, ((f.evidence_qpi_links as { qpi_code: string }[]) ?? []).map((l) => l.qpi_code).join(", ")]);
  } else if (k === "audit") {
    if (!user.isStateAdmin) return new NextResponse("Not found", { status: 404 });
    const { data } = await supabase.from("audit_events").select("occurred_at, actor_id, action, entity_type, entity_id, lea_id").order("occurred_at", { ascending: false }).limit(5000);
    columns = ["When", "Actor", "Action", "Entity type", "Entity", "LEA"];
    rows = (data ?? []).map((e) => [e.occurred_at, e.actor_id ?? "", e.action, e.entity_type, e.entity_id ?? "", e.lea_id ?? ""]);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "TAPE Online";
  const ws = wb.addWorksheet(k);
  ws.addRow(columns).font = { bold: true };
  for (const r of rows) ws.addRow(r);
  ws.columns.forEach((c) => { c.width = 18; });
  const buffer = await wb.xlsx.writeBuffer();
  await supabase.rpc("log_event", { p_action: `export.${k}`, p_entity_type: "export", p_entity_id: k, p_meta: { rows: rows.length } });
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="tape-${k}-${new Date().toISOString().slice(0, 10)}.xlsx"`, "Cache-Control": "no-store" } });
}
