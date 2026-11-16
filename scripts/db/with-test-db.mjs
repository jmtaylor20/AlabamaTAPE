// Start a throwaway local Postgres cluster, apply the auth shim and all
// migrations, run the given command with DATABASE_URL set, then stop the
// cluster. Used by `npm run test:policies` locally and in CI.
//
// If DATABASE_URL is already set (for example a CI service container), the
// cluster step is skipped and that database is used after a reset.
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import pg from "pg";
import { applyAll } from "./lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const command = process.argv.slice(2);
if (!command.length) {
  console.error("usage: node scripts/db/with-test-db.mjs <command...>");
  process.exit(1);
}

// Postgres refuses to run as root. When this script runs as root (some
// sandboxes and containers), run the server as the unprivileged postgres user.
const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
function pgRun(bin, args) {
  if (asRoot) return spawnSync("runuser", ["-u", "postgres", "--", bin, ...args], { stdio: "pipe", encoding: "utf8" });
  return spawnSync(bin, args, { stdio: "pipe", encoding: "utf8" });
}

function findPgBin() {
  const candidates = [process.env.PG_BIN, "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin", "/usr/local/pgsql/bin", "/opt/homebrew/opt/postgresql@16/bin", "/usr/bin"].filter(Boolean);
  for (const dir of candidates) {
    if (spawnSync(path.join(dir, "initdb"), ["--version"], { stdio: "ignore" }).status === 0) return dir;
  }
  throw new Error("Postgres binaries not found. Install postgresql or set PG_BIN.");
}

async function resetDatabase(adminUrl, dbName) {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);
  await admin.end();
}

let dataDir = null;
let pgBin = null;
let databaseUrl = process.env.DATABASE_URL;
const port = Number(process.env.TEST_PG_PORT ?? 54329);

try {
  if (!databaseUrl) {
    pgBin = findPgBin();
    dataDir = await mkdtemp(path.join(os.tmpdir(), "tape-pg-"));
    if (asRoot) spawnSync("chown", ["-R", "postgres", dataDir]);
    const init = pgRun(path.join(pgBin, "initdb"), ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-sync"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
    const start = pgRun(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-o", `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off`, "-l", path.join(dataDir, "log"), "-w", "start"]);
    if (start.status !== 0) throw new Error(`pg_ctl start failed: ${start.stderr || start.stdout}`);
    const adminUrl = `postgres://postgres@127.0.0.1:${port}/postgres`;
    await resetDatabase(adminUrl, "tape_test");
    databaseUrl = `postgres://postgres@127.0.0.1:${port}/tape_test`;
  } else {
    const u = new URL(databaseUrl);
    const dbName = u.pathname.slice(1) || "tape_test";
    u.pathname = "/postgres";
    await resetDatabase(u.toString(), dbName);
  }

  await applyAll(databaseUrl, { shim: true, log: () => {} });

  // Prefer the project's own binaries (node_modules/.bin) over anything on the PATH.
  const local = path.join(ROOT, "node_modules", ".bin", command[0]);
  const bin = existsSync(local) ? local : command[0];
  const child = spawn(bin, command.slice(1), {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const code = await new Promise((resolve) => child.on("exit", resolve));
  process.exitCode = code ?? 1;
} finally {
  if (dataDir && pgBin) {
    pgRun(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-m", "fast", "stop"]);
    await rm(dataDir, { recursive: true, force: true });
  }
}
