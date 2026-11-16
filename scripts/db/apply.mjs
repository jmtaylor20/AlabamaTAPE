// Apply pending migrations to DATABASE_URL (a Supabase project or any Postgres).
// Usage: DATABASE_URL=postgres://... node scripts/db/apply.mjs [--shim]
import { applyAll } from "./lib.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
await applyAll(url, { shim: process.argv.includes("--shim") });
