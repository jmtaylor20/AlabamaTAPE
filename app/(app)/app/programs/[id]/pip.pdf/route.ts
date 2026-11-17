import { NextResponse } from "next/server";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { createElement as h } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { loadProgram, type PipGoal, type ProgramData } from "@/lib/components/program";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { createUserClient } from "@/lib/supabase/server";

/** The PIP in the grid layout of the current spreadsheet: header, findings grid, goals with the three date columns, then monthly notes. */

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "center", marginBottom: 8 },
  row: { flexDirection: "row", marginBottom: 3 },
  cell: { borderWidth: 0.5, borderColor: "#374151", padding: 3 },
  label: { fontFamily: "Helvetica-Bold" },
  gridRow: { flexDirection: "row" },
  gridCell: { width: `${100 / 8}%`, borderWidth: 0.5, borderColor: "#374151", padding: 3, textAlign: "center" },
  hit: { backgroundColor: "#fde68a", fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 10, marginBottom: 4, borderWidth: 0.5, borderColor: "#374151", padding: 3 },
  head: { flexDirection: "row", fontFamily: "Helvetica-Bold" },
  c10: { width: "12%" }, cYear: { width: "12%" }, cNot: { width: "12%" }, cSteps: { width: "54%" }, cQpi: { width: "10%" },
  small: { fontSize: 7, color: "#6b7280", marginTop: 10 },
});

const GRID = [["", "", "1.1A", "1.1B", "1.1C", "1.1D", "1.1E", "1.1F"], ["1.1G", "2.1A", "2.1B", "2.1C", "2.1D", "2.1E", "2.1F", "2.1G"], ["2.1H", "3.1A", "3.1B", "3.1C", "3.1D", "3.1E", "4.1A", "5.1A"], ["5.1B", "5.2A", "", "", "", "", "", ""]];

function doc(data: ProgramData) {
  const { dp, lea, catalog, school, teachers, site } = data;
  const pip = site!.pip!;
  const codes = new Set(pip.goals.map((g) => g.qpi_code.replace(/\.(?=[A-Z]$)/, "")));
  const director = "";
  const cell = (label: string, value: string, width: string) => h(View, { style: [s.cell, { width }] }, h(Text, {}, [h(Text, { key: "l", style: s.label }, `${label} `), value]));
  const goalRow = (g: PipGoal, i: number) =>
    h(View, { key: i, style: s.gridRow, wrap: false },
      h(Text, { style: [s.cell, s.c10] }, g.status === "ten_days" ? fmtDate(g.date_accomplished) || "Yes" : ""),
      h(Text, { style: [s.cell, s.cYear] }, g.status === "one_year" ? fmtDate(g.date_accomplished) || "Yes" : ""),
      h(Text, { style: [s.cell, s.cNot] }, g.status === "not_complete" ? "X" : ""),
      h(Text, { style: [s.cell, s.cSteps] }, g.action_steps || " "),
      h(Text, { style: [s.cell, s.cQpi] }, g.qpi_code),
    );
  return h(Document, { title: `PIP ${dp.program_code} ${lea?.name ?? ""}` },
    h(Page, { size: "LETTER", orientation: "landscape", style: s.page },
      h(Text, { style: s.title }, "Program Improvement Plan"),
      h(View, { style: s.row }, cell("District:", lea?.name ?? "", "40%"), cell("Program:", `${dp.program_code} ${catalog?.name ?? ""}${school ? `, ${school.name}` : ""}`, "40%"), cell("Date:", fmtDate(pip.created_at), "20%")),
      h(View, { style: s.row }, cell("10 Day Window Closing Date:", fmtDate(pip.ten_day_close), "40%"), cell("One Year Completion Date:", fmtDate(pip.due_on), "40%"), cell("Closed?", pip.status === "closed" ? `Yes, ${fmtDate(pip.closed_at)}` : "No", "20%")),
      h(View, { style: s.row }, cell("Reviewer:", site!.reviewers.filter((r) => r.assignment_role !== "cluster_admin").map((r) => r.display_name ?? r.email).join(", "), "40%"), cell("CTE Director:", director, "40%"), cell("Teacher(s):", teachers.map((t) => t.display_name).join(", "), "20%")),
      h(Text, { style: s.h2 }, "Findings"),
      ...GRID.map((row, i) => h(View, { key: i, style: s.gridRow }, ...row.map((c, j) => h(Text, { key: j, style: [s.gridCell, ...(c && codes.has(c) ? [s.hit] : [])] }, c || " ")))),
      h(Text, { style: s.h2 }, "Goals"),
      h(View, { style: s.head }, h(Text, { style: [s.cell, s.c10] }, "Date Accomplished: 10 Days"), h(Text, { style: [s.cell, s.cYear] }, "One Year"), h(Text, { style: [s.cell, s.cNot] }, "Not Complete"), h(Text, { style: [s.cell, s.cSteps] }, "Action Step(s)"), h(Text, { style: [s.cell, s.cQpi] }, "QPI")),
      ...pip.goals.map(goalRow),
      h(Text, { style: s.small }, `Generated ${fmtDateTime(new Date().toISOString())}. TAPE Online, Alabama State Department of Education.`),
    ),
    h(Page, { size: "LETTER", orientation: "landscape", style: s.page },
      h(Text, { style: s.title }, "Program Improvement Plan: Notes and Explanations"),
      h(Text, { style: s.h2 }, "Monthly follow-up"),
      ...(pip.progress.length ? pip.progress.map((m) => h(Text, { key: m.month, style: { marginBottom: 3 } }, `Month ${m.month}${m.progress_lacking ? " (lacking progress)" : ""}: ${m.body}`)) : [h(Text, {}, "No monthly entries yet.")]),
      h(Text, { style: s.h2 }, "Notes"),
      ...(pip.notes.length ? pip.notes.map((n) => h(Text, { key: n.id, style: { marginBottom: 3 } }, `${fmtDate(n.created_at)} ${n.author_role}${n.author ? ` (${n.author})` : ""}: ${n.body}`)) : [h(Text, {}, "No notes.")]),
      ...(pip.escalations.length ? [h(Text, { style: s.h2 }, "Escalations"), ...pip.escalations.map((e) => h(Text, { key: e.month }, `Month ${e.month}: ${e.open_goals} open goal(s), ${fmtDate(e.notified_at)}`))] : []),
      ...(pip.close_note ? [h(Text, { style: s.h2 }, "Closing note"), h(Text, {}, pip.close_note)] : []),
    ),
  );
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") return NextResponse.redirect(new URL("/sign-in", req.url));
  const { id } = await params;
  const data = await loadProgram(id, user);
  if (!data || !data.site?.pip) return new NextResponse("Not found", { status: 404 });
  const buffer = await renderToBuffer(doc(data));
  const supabase = await createUserClient();
  await supabase.rpc("log_event", { p_action: "export.pip", p_entity_type: "pips", p_entity_id: data.site.pip.id, p_lea_id: data.dp.lea_id });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="tape-pip-${data.lea?.system_code ?? "lea"}-${data.dp.program_code}.pdf"`, "Cache-Control": "no-store" } });
}
