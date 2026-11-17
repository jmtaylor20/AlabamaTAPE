import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { loadProgram } from "@/lib/components/program";
import { buildReport } from "@/lib/report";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, td, th } from "@/lib/ui";

export const metadata: Metadata = { title: "Program review report" };

/** The report as a page. What appears here is exactly what the caller is allowed to read. */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const data = await loadProgram(id, user);
  if (!data) notFound();
  const r = buildReport(data);
  return (
    <>
      <PageHeader eyebrow={`${r.lea} / ${r.year}`} title={`Program review report: ${r.title}`} description={`${r.school}. ${r.teachers}. ${r.delivery}. Visit ${r.visit}. Reviewers: ${r.reviewers || "none"}. ${r.status}.`}
        actions={<><LinkButton href={`/app/programs/${id}`}>Program</LinkButton><LinkButton href={`/app/programs/${id}/report.pdf`} variant="primary">Download PDF</LinkButton></>} />
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {[["Applicable indicators", r.counts.applicable], ["Level 2", r.counts.level2], ["Level 1 (findings)", r.counts.level1], ["N/A", r.counts.na]].map(([label, n]) => <Card key={String(label)}><p className="text-3xl font-semibold tabular-nums">{n}</p><p className="text-sm text-ink-muted">{label}</p></Card>)}
      </div>
      <Card title="Scores">
        <Table caption="Scores" head={<tr><th className={th}>QPI</th><th className={th}>Director</th><th className={th}>Reviewer</th><th className={th}>Comment</th></tr>}>
          {r.rows.map((row) => (
            <tr key={row.code} className={row.applies ? "" : "opacity-60"}>
              <td className={td}><span className="font-mono text-xs">{row.code}</span> {row.title}{row.ase && <> <Badge tone="good">ASE</Badge></>}</td>
              <td className={td}>{row.director ? (row.director.value === "NA" ? "N/A" : row.director.value) : ""}</td>
              <td className={td}>{row.reviewer ? <Badge tone={row.reviewer.value === "2" ? "good" : row.reviewer.value === "1" ? "bad" : "neutral"}>{row.reviewer.value === "NA" ? "N/A" : `Level ${row.reviewer.value}`}</Badge> : ""}</td>
              <td className={td}>{row.reviewer?.na_reason ? `${row.reviewer.na_reason}. ` : ""}{row.reviewer?.comment ?? ""}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Findings">{r.findings.length === 0 ? <Empty>No findings.</Empty> : <ul className="divide-y divide-line text-sm">{r.findings.map((f, i) => <li key={i} className="py-2"><span className="font-mono text-xs">{f.code}</span> <Badge tone={f.status === "open" ? "bad" : "good"}>{f.status}</Badge> {f.teacher && <Badge>{f.teacher}</Badge>} {f.body}{f.cleared && <span className="block text-xs text-ink-muted">Cleared {f.cleared}</span>}</li>)}</ul>}</Card>
        <Card title="Random audits">{r.samples.length === 0 ? <Empty>No samples recorded.</Empty> : <ul className="divide-y divide-line text-sm">{r.samples.map((s, i) => <li key={i} className="py-2"><span className="font-mono text-xs">{s.code}</span> {s.kind}: {s.passed} of {s.sampled} passed</li>)}</ul>}</Card>
        {r.epic.length > 0 && <Card title="EPIC"><ul className="divide-y divide-line text-sm">{r.epic.map((e, i) => <li key={i} className="py-2">{e.text} <Badge>{e.value}</Badge></li>)}</ul></Card>}
        {r.comments.length > 0 && <Card title="Section comments"><ul className="divide-y divide-line text-sm">{r.comments.map((c, i) => <li key={i} className="py-2"><p className="font-semibold">{c.section}</p>{c.reviewer && <p>Reviewer: {c.reviewer}</p>}{c.director && <p className="text-ink-muted">Director: {c.director}</p>}</li>)}</ul></Card>}
        {r.deskAudit && <Card title="Desk audit"><p className="whitespace-pre-line text-sm">{r.deskAudit}</p></Card>}
      </div>
      <p className="mt-6 text-xs text-ink-muted">Generated {r.generatedAt}. TAPE Online, Alabama State Department of Education.</p>
    </>
  );
}
