// Proves the backup and restore procedure on a throwaway database: seed a few
// rows, export with backup.sh, restore into a second empty database with
// restore.sh, and compare row counts. Runs under with-test-db.mjs.
//   npm run check:backup
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set; run through scripts/db/with-test-db.mjs");
const src = new pg.Client({ connectionString: url });
await src.connect();
await src.query("insert into public.school_years (label, starts_on, ends_on, is_current) values ('2026-2027', '2026-07-01', '2027-06-30', true)");
await src.query("insert into public.clusters (code, name) values ('01', 'Agriculture'); insert into public.program_catalog (code, name, cluster_code) values ('10', 'General Agriculture', '01'); insert into public.leas (system_code, name) values ('901', 'Riverbend County')");
const before = (await src.query("select (select count(*) from public.leas) leas, (select count(*) from public.program_catalog) programs, (select count(*) from public.audit_events) events")).rows[0];
const dir = mkdtempSync(path.join(os.tmpdir(), "tape-backup-"));
const env = { ...process.env, DATABASE_URL: url, BACKUP_PASSPHRASE: "test-passphrase-only" };
const out = execFileSync("bash", ["scripts/db/backup.sh", dir], { env, encoding: "utf8" });
const file = /wrote (\S+)/.exec(out)?.[1];
if (!file) throw new Error(`backup did not report a file: ${out}`);
const enc = readFileSync(file);
if (enc.subarray(0, 8).toString() !== "Salted__") throw new Error("backup file is not encrypted");

// Second database on the same cluster.
const u = new URL(url);
const dbName = `tape_restore_${Date.now()}`;
await src.query(`create database ${dbName}`);
await src.end();
u.pathname = `/${dbName}`;
const dst = new pg.Client({ connectionString: u.toString() });
await dst.connect();
await dst.query(readFileSync("supabase/tests/auth_shim.sql", "utf8"));
await dst.end();
execFileSync("bash", ["scripts/db/restore.sh", file], { env: { ...env, DATABASE_URL: u.toString() }, encoding: "utf8" });
const check = new pg.Client({ connectionString: u.toString() });
await check.connect();
const after = (await check.query("select (select count(*) from public.leas) leas, (select count(*) from public.program_catalog) programs, (select count(*) from public.audit_events) events")).rows[0];
const policies = (await check.query("select count(*)::int as n from pg_policies where schemaname = 'public'")).rows[0].n;
await check.end();
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`row counts differ: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
if (policies < 50) throw new Error(`restored database has only ${policies} policies`);
console.log(`backup and restore verified: ${JSON.stringify(after)}, ${policies} policies restored, file ${path.basename(file)}`);
