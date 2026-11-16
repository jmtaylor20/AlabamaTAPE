import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
export const SHIM_FILE = path.join(ROOT, "supabase", "tests", "auth_shim.sql");

export async function listMigrations() {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return files.map((f) => path.join(MIGRATIONS_DIR, f));
}

/** Apply the local auth shim (if requested) and every migration, in order, inside one connection. */
export async function applyAll(databaseUrl, { shim = false, log = console.log } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (shim) {
      await client.query(await readFile(SHIM_FILE, "utf8"));
      log("applied auth shim");
    }
    await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query("select name from public.schema_migrations")).rows.map((r) => r.name));
    for (const file of await listMigrations()) {
      const name = path.basename(file);
      if (done.has(name)) continue;
      await client.query("begin");
      try {
        await client.query(await readFile(file, "utf8"));
        await client.query("insert into public.schema_migrations (name) values ($1)", [name]);
        await client.query("commit");
        log(`applied ${name}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`migration ${name} failed: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}
