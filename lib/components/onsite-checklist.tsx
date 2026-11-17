"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { saveOnsiteCheck } from "@/lib/actions/review";
import { Badge, Button } from "@/lib/ui";

type Item = { qpiCode: string; qpiTitle: string; subitemId: string; text: string; allowsNa: boolean };
type State = "met" | "not_met" | "NA";
type Pending = { subitemId: string; state: State; note?: string; capturedAt: string };

/**
 * The onsite checklist for 2.1.F, 2.1.G, and 5.2.A. Every tap is saved in the
 * browser first and sent to the server when a connection exists; anything that
 * cannot be sent waits in a queue and is replayed when the device comes back
 * online or the page is reopened. The sync state is always visible.
 */
function readStore(key: string): { local: Record<string, { state: State; note?: string }>; queue: Pending[] } {
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { local?: Record<string, { state: State; note?: string }>; queue?: Pending[] };
      return { local: parsed.local ?? {}, queue: parsed.queue ?? [] };
    }
  } catch {
    // Storage may be unavailable; the checklist still works for this visit.
  }
  return { local: {}, queue: [] };
}

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

export function OnsiteChecklist({ siteId, items, saved, locked }: { siteId: string; items: Item[]; saved: Record<string, { state: string; note: string | null }>; locked: boolean }) {
  const router = useRouter();
  const key = `tape.onsite.${siteId}`;
  const [store, setStore] = useState(() => readStore(key));
  const local = store.local;
  const queue = store.queue;
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");

  function persist(nextLocal: typeof local, nextQueue: Pending[]) {
    setStore({ local: nextLocal, queue: nextQueue });
    try { localStorage.setItem(key, JSON.stringify({ local: nextLocal, queue: nextQueue })); } catch { /* best effort */ }
  }

  async function flush(nextQueue: Pending[]) {
    if (!nextQueue.length || syncing) return;
    setSyncing(true);
    const remaining: Pending[] = [];
    let failed = "";
    for (const item of nextQueue) {
      try {
        const r = await saveOnsiteCheck({ siteId, subitemId: item.subitemId, state: item.state, note: item.note, capturedAt: item.capturedAt });
        if (!r.ok) { remaining.push(item); failed = r.error ?? "could not save"; }
      } catch {
        remaining.push(item);
        failed = "no connection";
      }
    }
    persist(local, remaining);
    setSyncing(false);
    setMessage(remaining.length ? `${remaining.length} waiting to sync (${failed}).` : "All checks synced.");
    if (!remaining.length) router.refresh();
  }

  // Replay the queue when the connection comes back (and on first load if something waited).
  useEffect(() => {
    if (!online || !queue.length || syncing) return;
    const t = setTimeout(() => void flush(queue), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, queue.length]);

  function tap(subitemId: string, state: State) {
    if (locked) return;
    const note = local[subitemId]?.note;
    const nextLocal = { ...local, [subitemId]: { state, note } };
    const nextQueue = [...queue.filter((q) => q.subitemId !== subitemId), { subitemId, state, note, capturedAt: new Date().toISOString() }];
    persist(nextLocal, nextQueue);
    if (navigator.onLine) void flush(nextQueue);
    else setMessage(`${nextQueue.length} saved on this device, waiting for a connection.`);
  }

  function current(subitemId: string): State | null {
    return local[subitemId]?.state ?? (saved[subitemId]?.state as State | undefined) ?? null;
  }

  const groups = new Map<string, Item[]>();
  for (const it of items) groups.set(it.qpiCode, [...(groups.get(it.qpiCode) ?? []), it]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={online ? "good" : "warn"}>{online ? "Online" : "Offline"}</Badge>
        {queue.length > 0 && <Badge tone="warn">{queue.length} waiting to sync</Badge>}
        {queue.length > 0 && online && <Button type="button" variant="secondary" className="min-h-9 px-3 text-xs" onClick={() => flush(queue)} disabled={syncing}>{syncing ? "Syncing" : "Sync now"}</Button>}
        {message && <span role="status" className="text-ink-muted">{message}</span>}
      </div>
      {[...groups.entries()].map(([code, list]) => (
        <section key={code} className="rounded-md border border-line p-3">
          <h3 className="font-semibold"><span className="font-mono text-xs">{code}</span> {list[0]?.qpiTitle}</h3>
          <ul className="mt-2 divide-y divide-line">
            {list.map((it) => {
              const st = current(it.subitemId);
              return (
                <li key={it.subitemId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="max-w-prose">{it.text}</span>
                  <div className="flex gap-1" role="group" aria-label={`Check for ${it.text}`}>
                    {(["met", "not_met", ...(it.allowsNa ? ["NA"] : [])] as State[]).map((v) => (
                      <button key={v} type="button" disabled={locked} onClick={() => tap(it.subitemId, v)} aria-pressed={st === v}
                        className={`min-h-11 rounded-md border px-3 text-sm font-semibold ${st === v ? (v === "met" ? "border-success bg-brand-soft text-success" : v === "not_met" ? "border-danger bg-danger-soft text-danger" : "border-line bg-brand-soft") : "border-line bg-surface hover:bg-brand-soft"} disabled:opacity-50`}>
                        {v === "met" ? "Met" : v === "not_met" ? "Not met" : "N/A"}
                      </button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {items.length === 0 && <p className="text-sm text-ink-muted">No onsite sub-items apply to this program.</p>}
    </div>
  );
}
