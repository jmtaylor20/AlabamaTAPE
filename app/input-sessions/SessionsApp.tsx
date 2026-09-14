"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { CROSSWALK, DEFAULT_TEAM_NAMES, QUESTIONS, type Question, type SubQuestion } from "./config";
import "./sessions.css";

type Entry = {
  id: string;
  item: string;
  custom: boolean;
  named: string;
  answers: Record<string, string[]>;
  other: Record<string, string>;
  notes: string;
};

type Team = {
  id: string;
  name: string;
  date: string;
  facilitator: string;
  participants: string;
  questions: Record<string, Entry[]>;
  additional: string;
};

type Store = { version: 1; teams: Team[]; updatedAt: string };

const KEY = "tape-input-sessions-v1";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function newEntry(): Entry {
  return { id: uid(), item: "", custom: false, named: "", answers: {}, other: {}, notes: "" };
}

function newTeam(name: string): Team {
  const questions: Record<string, Entry[]> = {};
  for (const q of QUESTIONS) questions[q.id] = q.mode === "single" ? [newEntry()] : [];
  return { id: uid(), name, date: "", facilitator: "", participants: "", questions, additional: "" };
}

function defaultStore(): Store {
  return { version: 1, teams: DEFAULT_TEAM_NAMES.map(newTeam), updatedAt: "" };
}

/** Make sure imported or older data has every question and entry field. */
function normalize(raw: unknown): Store {
  const base = defaultStore();
  if (!raw || typeof raw !== "object") return base;
  const teamsIn = (raw as { teams?: unknown }).teams;
  if (!Array.isArray(teamsIn) || teamsIn.length === 0) return base;
  const teams: Team[] = teamsIn.map((t, i) => {
    const src = (t ?? {}) as Partial<Team>;
    const team = newTeam(typeof src.name === "string" && src.name ? src.name : `Team ${i + 1}`);
    team.id = typeof src.id === "string" && src.id ? src.id : team.id;
    team.date = typeof src.date === "string" ? src.date : "";
    team.facilitator = typeof src.facilitator === "string" ? src.facilitator : "";
    team.participants = typeof src.participants === "string" ? src.participants : "";
    team.additional = typeof src.additional === "string" ? src.additional : "";
    for (const q of QUESTIONS) {
      const list = src.questions?.[q.id];
      if (Array.isArray(list) && list.length) {
        team.questions[q.id] = list.map((e) => {
          const src = (e ?? {}) as Partial<Entry>;
          const entry = newEntry();
          entry.id = typeof src.id === "string" && src.id ? src.id : entry.id;
          entry.item = typeof src.item === "string" ? src.item : "";
          entry.custom = Boolean(src.custom);
          entry.named = typeof src.named === "string" ? src.named : "";
          entry.notes = typeof src.notes === "string" ? src.notes : "";
          entry.answers = src.answers && typeof src.answers === "object" ? { ...src.answers } : {};
          entry.other = src.other && typeof src.other === "object" ? { ...src.other } : {};
          return entry;
        });
      }
    }
    return team;
  });
  return { version: 1, teams, updatedAt: typeof (raw as Store).updatedAt === "string" ? (raw as Store).updatedAt : "" };
}

function load(): Store {
  try {
    const text = window.localStorage.getItem(KEY);
    return text ? normalize(JSON.parse(text)) : defaultStore();
  } catch {
    return defaultStore();
  }
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function entryLabel(q: Question, e: Entry) {
  return q.mode === "single" ? "" : e.item.trim();
}

function shortDisposition(value: string) {
  return value.replace("Move to ", "").replace(" compliance monitoring", " compliance").replace(" program review", "").replace(" completely", "");
}

/* ---------- report math ---------- */

type Tally = { option: string; teams: Set<string>; entries: number };

function tally(teams: Team[], q: Question, sub: SubQuestion): Tally[] {
  const map = new Map<string, Tally>();
  for (const option of sub.options) map.set(option, { option, teams: new Set(), entries: 0 });
  for (const team of teams) {
    for (const e of team.questions[q.id] ?? []) {
      for (const option of e.answers[sub.id] ?? []) {
        const t = map.get(option) ?? { option, teams: new Set(), entries: 0 };
        t.teams.add(team.id);
        t.entries += 1;
        map.set(option, t);
      }
      const other = e.other[sub.id]?.trim();
      if (other) {
        const key = `Other: ${other}`;
        const t = map.get(key) ?? { option: key, teams: new Set(), entries: 0 };
        t.teams.add(team.id);
        t.entries += 1;
        map.set(key, t);
      }
    }
  }
  return [...map.values()].sort((a, b) => b.teams.size - a.teams.size || b.entries - a.entries);
}

type ItemRow = { item: string; teams: Set<string>; entries: { team: Team; entry: Entry }[] };

function itemRows(teams: Team[], q: Question): ItemRow[] {
  const map = new Map<string, ItemRow>();
  for (const team of teams) {
    for (const e of team.questions[q.id] ?? []) {
      const item = e.item.trim();
      if (!item) continue;
      const key = item.toLowerCase();
      const row = map.get(key) ?? { item, teams: new Set(), entries: [] };
      row.teams.add(team.id);
      row.entries.push({ team, entry: e });
      map.set(key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.teams.size - a.teams.size || a.item.localeCompare(b.item));
}

type DispositionRow = { item: string; byTeam: Record<string, Set<string>>; suggested: string; questions: Set<number> };

function dispositionRows(teams: Team[]): DispositionRow[] {
  const map = new Map<string, DispositionRow>();
  for (const q of QUESTIONS.filter((x) => x.mode === "list")) {
    for (const team of teams) {
      for (const e of team.questions[q.id] ?? []) {
        const item = e.item.trim();
        if (!item) continue;
        const key = item.toLowerCase();
        const row = map.get(key) ?? {
          item,
          byTeam: {},
          suggested: CROSSWALK.find((c) => c.item.toLowerCase() === key)?.suggested ?? "",
          questions: new Set<number>(),
        };
        row.questions.add(q.number);
        const set = row.byTeam[team.id] ?? new Set<string>();
        for (const d of e.answers.disposition ?? []) set.add(d);
        row.byTeam[team.id] = set;
        map.set(key, row);
      }
    }
  }
  return [...map.values()].sort((a, b) => a.item.localeCompare(b.item));
}

function agreement(row: DispositionRow, teams: Team[]) {
  const votes = new Map<string, number>();
  for (const team of teams) for (const d of row.byTeam[team.id] ?? []) votes.set(d, (votes.get(d) ?? 0) + 1);
  let best = "";
  let count = 0;
  for (const [d, n] of votes) if (n > count) { best = d; count = n; }
  return { best, count };
}

function badge(count: number, total: number) {
  if (total > 0 && count === total) return <span className="badge all">ALL TEAMS</span>;
  if (count > total / 2) return <span className="badge maj">MAJORITY</span>;
  return <span className="badge">{count} OF {total}</span>;
}

/* ---------- markdown + csv ---------- */

function buildMarkdown(store: Store) {
  const teams = store.teams;
  const lines: string[] = [];
  lines.push(`# TAPE Input Sessions Report`, ``, `Generated ${stamp()}.`, ``, `## Sessions`, ``, `| Team | Date | Facilitator | Participants |`, `|---|---|---|---|`);
  for (const t of teams) lines.push(`| ${t.name} | ${t.date || "—"} | ${t.facilitator || "—"} | ${t.participants || "—"} |`);
  const disp = dispositionRows(teams);
  if (disp.length) {
    lines.push(``, `## Disposition matrix`, ``, `| Item | Named in | ${teams.map((t) => t.name).join(" | ")} | Suggested home (crosswalk) | Agreement |`, `|---|---|${teams.map(() => "---").join("|")}|---|---|`);
    for (const row of disp) {
      const a = agreement(row, teams);
      lines.push(`| ${row.item} | Q${[...row.questions].sort().join(", Q")} | ${teams.map((t) => [...(row.byTeam[t.id] ?? [])].map(shortDisposition).join("; ") || "—").join(" | ")} | ${row.suggested || "—"} | ${a.best ? `${shortDisposition(a.best)} (${a.count}/${teams.length})` : "—"} |`);
    }
  }
  for (const q of QUESTIONS) {
    lines.push(``, `## ${q.number}. ${q.title}`);
    if (q.mode === "list") {
      const rows = itemRows(teams, q);
      lines.push(``, `### Items named`, ``, `| Item | Teams | ${teams.map((t) => t.name).join(" | ")} |`, `|---|---|${teams.map(() => "---").join("|")}|`);
      for (const r of rows) lines.push(`| ${r.item} | ${r.teams.size}/${teams.length} | ${teams.map((t) => (r.teams.has(t.id) ? "✓" : "")).join(" | ")} |`);
      if (!rows.length) lines.push(`| (none yet) | | ${teams.map(() => "").join(" | ")} |`);
    } else {
      lines.push(``, `### Named by each team`, ``);
      for (const t of teams) {
        const named = (t.questions[q.id]?.[0]?.named ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
        lines.push(`- **${t.name}:** ${named.length ? named.join("; ") : "—"}`);
      }
    }
    for (const sub of q.subs) {
      lines.push(``, `### ${sub.short}`, ``, `_${sub.prompt}_`, ``, `| Response | Teams | Entries |`, `|---|---|---|`);
      for (const t of tally(teams, q, sub)) if (t.teams.size) lines.push(`| ${t.option} | ${t.teams.size}/${teams.length} | ${t.entries} |`);
    }
    const notes: string[] = [];
    for (const t of teams) for (const e of t.questions[q.id] ?? []) if (e.notes.trim()) notes.push(`- **${t.name}${entryLabel(q, e) ? ` · ${entryLabel(q, e)}` : ""}:** ${e.notes.trim().replaceAll("\n", " ")}`);
    if (notes.length) lines.push(``, `### Notes`, ``, ...notes);
  }
  lines.push(``, `## 5. Additional input`, ``);
  for (const t of teams) lines.push(`- **${t.name}:** ${t.additional.trim() ? t.additional.trim().replaceAll("\n", " ") : "—"}`);
  return lines.join("\n");
}

function buildCsv(store: Store) {
  const rows: string[][] = [["Team", "Date", "Question", "Item", "Prompt", "Response", "Notes"]];
  for (const t of store.teams) {
    for (const q of QUESTIONS) {
      for (const e of t.questions[q.id] ?? []) {
        const item = q.mode === "single" ? e.named.split("\n").map((s) => s.trim()).filter(Boolean).join("; ") : e.item.trim();
        let any = false;
        for (const sub of q.subs) {
          for (const opt of e.answers[sub.id] ?? []) { rows.push([t.name, t.date, `Q${q.number} ${q.title}`, item, sub.prompt, opt, e.notes]); any = true; }
          if (e.other[sub.id]?.trim()) { rows.push([t.name, t.date, `Q${q.number} ${q.title}`, item, sub.prompt, `Other: ${e.other[sub.id].trim()}`, e.notes]); any = true; }
        }
        if (!any && (item || e.notes.trim())) rows.push([t.name, t.date, `Q${q.number} ${q.title}`, item, "", "", e.notes]);
      }
    }
    if (t.additional.trim()) rows.push([t.name, t.date, "Q5 Additional input", "", "", t.additional.trim(), ""]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/* ---------- UI ---------- */

function Chips({ sub, entry, onChange }: { sub: SubQuestion; entry: Entry; onChange: (next: Entry) => void }) {
  const selected = entry.answers[sub.id] ?? [];
  const toggle = (option: string) => {
    const next = selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option];
    onChange({ ...entry, answers: { ...entry.answers, [sub.id]: next } });
  };
  return (
    <div className="sub">
      <p>{sub.prompt}</p>
      <div className="chips">
        {sub.options.map((option) => {
          const on = selected.includes(option);
          return (
            <label key={option} className={`chip${on ? " on" : ""}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(option)} />
              {option}
            </label>
          );
        })}
      </div>
      <div className="other">
        <span className="chip other">Other</span>
        <input
          type="text"
          placeholder="Anything not covered above"
          value={entry.other[sub.id] ?? ""}
          onChange={(ev) => onChange({ ...entry, other: { ...entry.other, [sub.id]: ev.target.value } })}
        />
      </div>
    </div>
  );
}

function EntryEditor({ q, entry, index, onChange, onRemove }: { q: Question; entry: Entry; index: number; onChange: (next: Entry) => void; onRemove?: () => void }) {
  const picklist = q.picklist ?? [];
  const selectValue = entry.custom ? "__custom" : entry.item;
  return (
    <div className="entry">
      {q.mode === "list" ? (
        <div className="entryHead">
          <label className="field">
            {q.entryLabel} {index + 1}
            <select
              value={selectValue}
              onChange={(ev) => {
                const v = ev.target.value;
                if (v === "__custom") onChange({ ...entry, custom: true, item: "" });
                else onChange({ ...entry, custom: false, item: v });
              }}
            >
              <option value="">Select an item…</option>
              {picklist.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="__custom">Custom item…</option>
            </select>
          </label>
          {entry.custom && (
            <label className="field">
              Custom item name
              <input type="text" value={entry.item} placeholder="Type the item the team named" onChange={(ev) => onChange({ ...entry, item: ev.target.value })} />
            </label>
          )}
          {onRemove && <button type="button" className="btn small danger" onClick={onRemove}>Remove</button>}
        </div>
      ) : (
        q.namedLabel && (
          <label className="field">
            {q.namedLabel}
            <textarea value={entry.named} onChange={(ev) => onChange({ ...entry, named: ev.target.value })} placeholder="One per line" />
          </label>
        )
      )}
      {q.subs.map((sub) => <Chips key={sub.id} sub={sub} entry={entry} onChange={onChange} />)}
      <label className="field notes">
        Notes / quotes
        <textarea value={entry.notes} onChange={(ev) => onChange({ ...entry, notes: ev.target.value })} placeholder="What the team said, in their words" />
      </label>
    </div>
  );
}

function TeamView({ team, canRemove, onChange, onRemove }: { team: Team; canRemove: boolean; onChange: (next: Team) => void; onRemove: () => void }) {
  const setEntries = (qid: string, entries: Entry[]) => onChange({ ...team, questions: { ...team.questions, [qid]: entries } });
  return (
    <div>
      <div className="card">
        <h2><small>SESSION DETAILS</small>{team.name || "Team"}</h2>
        <p className="hint">Enter the basics for this small-group session. Everything saves automatically in this browser.</p>
        <div className="meta">
          <label className="field">Team name<input type="text" value={team.name} onChange={(ev) => onChange({ ...team, name: ev.target.value })} /></label>
          <label className="field">Session date<input type="date" value={team.date} onChange={(ev) => onChange({ ...team, date: ev.target.value })} /></label>
          <label className="field">Facilitator<input type="text" value={team.facilitator} onChange={(ev) => onChange({ ...team, facilitator: ev.target.value })} /></label>
          <label className="field">Participants (names or count)<input type="text" value={team.participants} onChange={(ev) => onChange({ ...team, participants: ev.target.value })} /></label>
        </div>
        {canRemove && <div className="rowActions"><button type="button" className="btn small danger" onClick={onRemove}>Remove this team</button></div>}
      </div>

      {QUESTIONS.map((q) => {
        const entries = team.questions[q.id] ?? [];
        return (
          <div className="card" key={q.id}>
            <h2><small>QUESTION {q.number}</small>{q.title}</h2>
            <p className="hint">{q.entryHint}</p>
            {q.mode === "list" && entries.length === 0 && <div className="empty">No items yet. Add the first item the team names.</div>}
            {entries.map((entry, i) => (
              <EntryEditor
                key={entry.id}
                q={q}
                entry={entry}
                index={i}
                onChange={(next) => setEntries(q.id, entries.map((e) => (e.id === next.id ? next : e)))}
                onRemove={q.mode === "list" ? () => setEntries(q.id, entries.filter((e) => e.id !== entry.id)) : undefined}
              />
            ))}
            {q.mode === "list" && (
              <div className="add"><button type="button" className="btn primary" onClick={() => setEntries(q.id, [...entries, newEntry()])}>+ Add {q.entryLabel.toLowerCase()}</button></div>
            )}
          </div>
        );
      })}

      <div className="card">
        <h2><small>QUESTION 5</small>Additional input</h2>
        <p className="hint">Anything else the team raised that does not fit the four questions above.</p>
        <label className="field"><textarea value={team.additional} onChange={(ev) => onChange({ ...team, additional: ev.target.value })} placeholder="Parking lot, concerns, ideas" /></label>
      </div>
    </div>
  );
}

function TallyTable({ teams, q, sub }: { teams: Team[]; q: Question; sub: SubQuestion }) {
  const rows = tally(teams, q, sub).filter((t) => t.teams.size > 0);
  return (
    <div>
      <h3>{sub.short}</h3>
      <p className="hint" style={{ marginBottom: 4 }}>{sub.prompt}</p>
      {rows.length === 0 ? <p className="hint">No responses yet.</p> : (
        <div className="tableWrap">
          <table>
            <thead><tr><th>Response</th><th className="c">Teams</th>{teams.map((t) => <th key={t.id} className="c">{t.name}</th>)}<th className="c">Entries</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.option}>
                  <td><span className="bar" style={{ width: `${Math.max(6, (r.teams.size / Math.max(1, teams.length)) * 60)}px` }} />{r.option}</td>
                  <td className="c">{badge(r.teams.size, teams.length)}</td>
                  {teams.map((t) => <td key={t.id} className="c">{r.teams.has(t.id) ? <span className="tick">✓</span> : ""}</td>)}
                  <td className="c">{r.entries}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReportView({ store }: { store: Store }) {
  const teams = store.teams;
  const disp = dispositionRows(teams);
  const totalEntries = teams.reduce((n, t) => n + QUESTIONS.filter((q) => q.mode === "list").reduce((m, q) => m + (t.questions[q.id] ?? []).filter((e) => e.item.trim()).length, 0), 0);
  const consensus = disp.filter((r) => agreement(r, teams).count === teams.length && teams.length > 1).length;
  const teamsWithData = teams.filter((t) => QUESTIONS.some((q) => (t.questions[q.id] ?? []).some((e) => e.item.trim() || e.named.trim() || e.notes.trim() || Object.values(e.answers).some((a) => a.length))) || t.additional.trim()).length;

  return (
    <div className="rpt">
      <div className="card">
        <h2><small>COMBINED REPORT</small>TAPE Input Sessions</h2>
        <p className="hint printOnly">Generated {stamp()}.</p>
        <p className="hint">Combines every team&apos;s answers. Items and responses are sorted by how many teams chose them.</p>
        <div className="summaryStrip">
          <div><b>{teamsWithData}/{teams.length}</b><small>TEAMS WITH INPUT</small></div>
          <div><b>{totalEntries}</b><small>ITEM ENTRIES (Q1 + Q2)</small></div>
          <div><b>{disp.length}</b><small>DISTINCT ITEMS DISCUSSED</small></div>
          <div><b>{consensus}</b><small>ITEMS WITH FULL AGREEMENT</small></div>
        </div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Team</th><th>Date</th><th>Facilitator</th><th>Participants</th></tr></thead>
            <tbody>{teams.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.date || "—"}</td><td>{t.facilitator || "—"}</td><td>{t.participants || "—"}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2><small>KEEP · MOVE · REMOVE</small>Disposition matrix</h2>
        <p className="hint">Every item named under Question 1 or 2, with each team&apos;s answer to &quot;Where should this item live?&quot; and the suggested home from the compliance crosswalk.</p>
        {disp.length === 0 ? <p className="hint">No items yet.</p> : (
          <div className="tableWrap">
            <table>
              <thead><tr><th>Item</th><th className="c">Named in</th>{teams.map((t) => <th key={t.id}>{t.name}</th>)}<th>Crosswalk suggestion</th><th>Agreement</th></tr></thead>
              <tbody>
                {disp.map((row) => {
                  const a = agreement(row, teams);
                  return (
                    <tr key={row.item}>
                      <td>{row.item}</td>
                      <td className="c">Q{[...row.questions].sort().join(", Q")}</td>
                      {teams.map((t) => <td key={t.id}>{[...(row.byTeam[t.id] ?? [])].map(shortDisposition).join("; ") || "—"}</td>)}
                      <td>{row.suggested ? shortDisposition(row.suggested) : "—"}</td>
                      <td>{a.best ? <>{shortDisposition(a.best)} {badge(a.count, teams.length)}</> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {QUESTIONS.map((q) => {
        const rows = q.mode === "list" ? itemRows(teams, q) : [];
        const notes: { team: Team; entry: Entry }[] = [];
        for (const t of teams) for (const e of t.questions[q.id] ?? []) if (e.notes.trim()) notes.push({ team: t, entry: e });
        return (
          <div className="card" key={q.id}>
            <h2><small>QUESTION {q.number}</small>{q.title}</h2>
            {q.mode === "list" ? (
              <>
                <h3>Items named</h3>
                {rows.length === 0 ? <p className="hint">No items yet.</p> : (
                  <div className="tableWrap">
                    <table>
                      <thead><tr><th>Item</th><th className="c">Teams</th>{teams.map((t) => <th key={t.id} className="c">{t.name}</th>)}</tr></thead>
                      <tbody>{rows.map((r) => <tr key={r.item}><td>{r.item}</td><td className="c">{badge(r.teams.size, teams.length)}</td>{teams.map((t) => <td key={t.id} className="c">{r.teams.has(t.id) ? <span className="tick">✓</span> : ""}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <h3>Named by each team</h3>
                <ul className="noteList">
                  {teams.map((t) => {
                    const named = (t.questions[q.id]?.[0]?.named ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
                    return <li key={t.id}><b>{t.name}:</b> {named.length ? named.join("; ") : "—"}</li>;
                  })}
                </ul>
              </>
            )}
            <div className="rptGrid" style={{ marginTop: 18 }}>
              {q.subs.map((sub) => <TallyTable key={sub.id} teams={teams} q={q} sub={sub} />)}
            </div>
            {notes.length > 0 && (
              <>
                <h3 style={{ marginTop: 18 }}>Notes and quotes</h3>
                <ul className="noteList">{notes.map(({ team, entry }) => <li key={entry.id}><b>{team.name}{entryLabel(q, entry) ? ` · ${entryLabel(q, entry)}` : ""}:</b> {entry.notes.trim()}</li>)}</ul>
              </>
            )}
          </div>
        );
      })}

      <div className="card">
        <h2><small>QUESTION 5</small>Additional input</h2>
        <ul className="noteList">{teams.map((t) => <li key={t.id}><b>{t.name}:</b> {t.additional.trim() || "—"}</li>)}</ul>
      </div>

      <div className="card">
        <h2><small>REFERENCE</small>TAPE to compliance crosswalk</h2>
        <p className="hint">Starting point for the &quot;where should it live&quot; discussion: each TAPE item, the requirement behind it, and a suggested home once program review and compliance monitoring are separated.</p>
        <div className="tableWrap">
          <table>
            <thead><tr><th>TAPE item</th><th>Basis</th><th>Citation</th><th>Suggested home</th></tr></thead>
            <tbody>{CROSSWALK.map((c) => <tr key={c.item}><td>{c.item}</td><td>{c.basis}</td><td>{c.citation}</td><td>{shortDisposition(c.suggested)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="crossNote">Citations are a working reconstruction and should be verified against the earlier TAPE and compliance analysis before the crosswalk is shared outside the team. Edit the list in app/input-sessions/config.ts.</p>
      </div>
    </div>
  );
}

export default function SessionsApp() {
  const [store, setStore] = useState<Store>(load);
  const [tab, setTab] = useState<string>(() => store.teams[0]?.id ?? "report");
  const [savedAt, setSavedAt] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Update state and persist to this browser in one step. */
  const commit = (next: Store) => {
    setStore(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ ...next, updatedAt: new Date().toISOString() }));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch {
      setSavedAt("not saved (storage unavailable)");
    }
  };

  const markdown = useMemo(() => buildMarkdown(store), [store]);
  const activeTeam = store.teams.find((t) => t.id === tab);

  const updateTeam = (next: Team) => commit({ ...store, teams: store.teams.map((t) => (t.id === next.id ? next : t)) });
  const addTeam = () => {
    const team = newTeam(`Team ${store.teams.length + 1}`);
    commit({ ...store, teams: [...store.teams, team] });
    setTab(team.id);
  };
  const removeTeam = (id: string) => {
    if (!window.confirm("Remove this team and all of its answers?")) return;
    const teams = store.teams.filter((t) => t.id !== id);
    commit({ ...store, teams });
    setTab(teams[0]?.id ?? "report");
  };
  const reset = () => {
    if (!window.confirm("Clear every team's answers? Export first if you want a backup.")) return;
    const fresh = defaultStore();
    commit(fresh);
    setTab(fresh.teams[0].id);
  };
  const importFile = async (file: File) => {
    try {
      const parsed = normalize(JSON.parse(await file.text()));
      if (!window.confirm(`Replace the current data with ${file.name}?`)) return;
      commit(parsed);
      setTab(parsed.teams[0].id);
    } catch {
      window.alert("That file could not be read as a TAPE input sessions export.");
    }
  };
  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      download(`TAPE_Input_Sessions_Report_${stamp()}.md`, markdown, "text/markdown");
    }
  };

  return (
    <main className="sess">
      <div className="notice">INPUT SESSIONS <span>Facilitator data collection for the TAPE redesign. Data stays in this browser until you export it.</span></div>
      <header className="siteHeader">
        <Link className="brand" href="/" aria-label="TAPE Resource Hub home"><span className="stateMark">AL</span><span><b>TAPE</b><small>RESOURCE HUB · ALABAMA CTE</small></span></Link>
        <nav aria-label="Primary navigation"><Link href="/">Resource Hub</Link><Link className="navMore" href="/input-sessions">Input Sessions</Link></nav>
      </header>

      <section className="intro">
        <p className="eyebrow"><span /> SMALL-GROUP INPUT SESSIONS</p>
        <h1>What stays in TAPE, what moves to compliance, what goes away.</h1>
        <p>Alabama is the last state reviewing CTE this way. Use one tab per team to capture what each group says as they say it, then open the report to see where the teams agree, which items should move to Perkins, fiscal, or civil rights monitoring, and what can be removed completely.</p>
      </section>

      <div className="toolbar noPrint">
        <div className="tabs">
          {store.teams.map((t) => <button type="button" key={t.id} className={`tab${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>{t.name || "Team"}</button>)}
          <button type="button" className="tab" onClick={addTeam} title="Add another team">+ Team</button>
          <button type="button" className={`tab report${tab === "report" ? " active" : ""}`} onClick={() => setTab("report")}>Combined report</button>
        </div>
        {tab === "report" && <button type="button" className="btn primary" onClick={() => window.print()}>Print / PDF</button>}
        <button type="button" className="btn" onClick={copyMarkdown}>{copied ? "Copied" : "Copy report"}</button>
        <button type="button" className="btn" onClick={() => download(`TAPE_Input_Sessions_Report_${stamp()}.csv`, buildCsv(store), "text/csv")}>CSV</button>
        <button type="button" className="btn" onClick={() => download(`TAPE_Input_Sessions_${stamp()}.json`, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2), "application/json")}>Export JSON</button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Import JSON</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(ev) => { const f = ev.target.files?.[0]; if (f) void importFile(f); ev.target.value = ""; }} />
        <button type="button" className="btn danger" onClick={reset}>Reset</button>
        <span className="saved">{savedAt ? `Saved ${savedAt}` : store.updatedAt ? `Loaded ${new Date(store.updatedAt).toLocaleString()}` : "Not saved yet"}</span>
      </div>

      <div className="wrap">
        {tab === "report" || !activeTeam ? (
          <ReportView store={store} />
        ) : (
          <TeamView team={activeTeam} canRemove={store.teams.length > 1} onChange={updateTeam} onRemove={() => removeTeam(activeTeam.id)} />
        )}
      </div>

      <footer><div className="brand"><span className="stateMark">AL</span><span><b>TAPE</b><small>RESOURCE HUB · ALABAMA CTE</small></span></div><p>Better evidence. Better programs. Better Alabama.</p><div><Link href="/">Back to the Resource Hub</Link><small>Facilitator tool · Not the official Cognia platform</small></div></footer>
    </main>
  );
}
