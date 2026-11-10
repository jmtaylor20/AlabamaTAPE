// Shared storage for the input sessions: a single `tape_teams` table in
// Supabase, accessed through PostgREST with a facilitator passcode header.
// Every request must carry `x-tape-key`; the database policy rejects the rest.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://buubrapkkqyalecwbhkh.supabase.co";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_KEY ?? "sb_publishable_h-KXdNNW7Tc_BFut25s_sQ_ypIidBJB";

export type Row<T> = { id: string; position: number; data: T; updated_at: string };

function headers(passcode: string, extra: Record<string, string> = {}) {
  return { apikey: SUPABASE_KEY, "x-tape-key": passcode, "content-type": "application/json", ...extra };
}

/** True when the passcode is accepted by the database policy. */
export async function ping(passcode: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tape_ping`, { method: "POST", headers: headers(passcode), body: "{}" });
  if (!res.ok) throw new Error(`ping ${res.status}`);
  return (await res.json()) === true;
}

export async function fetchRows<T>(passcode: string): Promise<Row<T>[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tape_teams?select=id,position,data,updated_at&order=position.asc`, { headers: headers(passcode) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  return res.json();
}

export async function upsertRows<T>(passcode: string, rows: { id: string; position: number; data: T }[]): Promise<Row<T>[]> {
  if (!rows.length) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tape_teams`, {
    method: "POST",
    headers: headers(passcode, { prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`upsert ${res.status}`);
  return res.json();
}

export async function deleteRows(passcode: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const list = ids.map((id) => `"${id.replaceAll('"', "")}"`).join(",");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tape_teams?id=in.(${list})`, { method: "DELETE", headers: headers(passcode) });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}
