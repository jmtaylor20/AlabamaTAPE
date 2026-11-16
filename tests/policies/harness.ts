import pg from "pg";

/**
 * Helpers for row-level security tests. Each test runs queries inside a
 * transaction as a specific database role with specific JWT claims, exactly
 * the way PostgREST does in Supabase, then rolls back.
 */

export type Claims = {
  sub?: string;
  role?: "anon" | "authenticated" | "service_role";
  aal?: "aal1" | "aal2";
  email?: string;
  amr?: { method: string; timestamp: number }[];
};

export function pool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Run through scripts/db/with-test-db.mjs.");
  return new pg.Pool({ connectionString: url, max: 2 });
}

export async function withRole<T>(p: pg.Pool, claims: Claims, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await p.connect();
  const role = claims.role ?? (claims.sub ? "authenticated" : "anon");
  const jwt = { role, ...claims, aal: claims.aal ?? (claims.sub ? "aal2" : "aal1") };
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(jwt)]);
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** Run as the migration owner (bypasses RLS). For arranging test data only. */
export async function asOwner<T>(p: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function expectDenied(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "42501" || code === "42P01") return;
    throw err;
  }
  throw new Error("expected the query to be denied, but it succeeded");
}
