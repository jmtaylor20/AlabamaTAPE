import { NextResponse } from "next/server";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createElement as h } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { loadProgram } from "@/lib/components/program";
import { buildReport, type Report } from "@/lib/report";
import { createUserClient } from "@/lib/supabase/server";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1f2937" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  muted: { color: "#6b7280" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#d1d5db", paddingVertical: 3 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#374151", paddingVertical: 3, fontFamily: "Helvetica-Bold" },
  c1: { width: "46%" }, c2: { width: "12%" }, c3: { width: "12%" }, c4: { width: "30%" },
  small: { fontSize: 8, color: "#6b7280", marginTop: 16 },
});

function reportDoc(r: Report) {
  return h(Document, { title: `TAPE review ${r.title}` },
    h(Page, { size: "LETTER", style: styles.page },
      h(Text, { style: styles.h1 }, `Program review report: ${r.title}`),
      h(Text, { style: styles.muted }, `${r.lea} (system ${r.systemCode}), ${r.year}. ${r.school}.`),
      h(Text, { style: styles.muted }, `Teachers: ${r.teachers}. ${r.delivery}.`),
      h(Text, { style: styles.muted }, `Visit ${r.visit}. Reviewers: ${r.reviewers || "none"}. ${r.status}.`),
      h(Text, { style: styles.h2 }, `Summary: ${r.counts.level2} at Level 2, ${r.counts.level1} at Level 1, ${r.counts.na} N/A of ${r.counts.applicable} applicable indicators`),
      h(Text, { style: styles.h2 }, "Scores"),
      h(View, { style: styles.head }, h(Text, { style: styles.c1 }, "Quality indicator"), h(Text, { style: styles.c2 }, "Director"), h(Text, { style: styles.c3 }, "Reviewer"), h(Text, { style: styles.c4 }, "Comment")),
      ...r.rows.map((row) => h(View, { style: styles.row, key: row.code, wrap: false },
        h(Text, { style: styles.c1 }, `${row.code} ${row.title}${row.ase ? " (ASE)" : ""}`),
        h(Text, { style: styles.c2 }, row.director ? (row.director.value === "NA" ? "N/A" : row.director.value) : ""),
        h(Text, { style: styles.c3 }, row.reviewer ? (row.reviewer.value === "NA" ? "N/A" : `Level ${row.reviewer.value}`) : ""),
        h(Text, { style: styles.c4 }, `${row.reviewer?.na_reason ? `${row.reviewer.na_reason}. ` : ""}${row.reviewer?.comment ?? ""}`),
      )),
      h(Text, { style: styles.h2 }, "Findings"),
      ...(r.findings.length ? r.findings.map((f, i) => h(Text, { key: i, style: { marginBottom: 3 } }, `${f.code} (${f.status}${f.teacher ? `, ${f.teacher}` : ""}): ${f.body}${f.cleared ? ` Cleared ${f.cleared}` : ""}`)) : [h(Text, { style: styles.muted }, "No findings.")]),
      h(Text, { style: styles.h2 }, "Random audits"),
      ...(r.samples.length ? r.samples.map((s, i) => h(Text, { key: i }, `${s.code} ${s.kind}: ${s.passed} of ${s.sampled} passed`)) : [h(Text, { style: styles.muted }, "No samples recorded.")]),
      ...(r.epic.length ? [h(Text, { style: styles.h2 }, "EPIC"), ...r.epic.map((e, i) => h(Text, { key: i, style: { marginBottom: 2 } }, `${e.value}: ${e.text}`))] : []),
      ...(r.comments.length ? [h(Text, { style: styles.h2 }, "Section comments"), ...r.comments.map((c, i) => h(View, { key: i, style: { marginBottom: 4 } }, h(Text, { style: { fontFamily: "Helvetica-Bold" } }, c.section), c.reviewer ? h(Text, {}, `Reviewer: ${c.reviewer}`) : null, c.director ? h(Text, { style: styles.muted }, `Director: ${c.director}`) : null))] : []),
      ...(r.deskAudit ? [h(Text, { style: styles.h2 }, "Desk audit"), h(Text, {}, r.deskAudit)] : []),
      h(Text, { style: styles.small }, `Generated ${r.generatedAt}. TAPE Online, Alabama State Department of Education. This report reflects the records the requesting user may read.`),
    ),
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") return NextResponse.redirect(new URL("/sign-in", req.url));
  const { id } = await params;
  const data = await loadProgram(id, user);
  if (!data) return new NextResponse("Not found", { status: 404 });
  const report = buildReport(data);
  const buffer = await renderToBuffer(reportDoc(report));
  const supabase = await createUserClient();
  await supabase.rpc("log_event", { p_action: "export.program_report", p_entity_type: "declared_programs", p_entity_id: id, p_lea_id: data.dp.lea_id });
  const name = `tape-review-${report.systemCode}-${data.dp.program_code}-${report.year}.pdf`;
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
}
