import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Scheduled escalation check. Called daily by a scheduler with the shared
 * secret in the Authorization header; the same work is also scheduled inside
 * the database with pg_cron (scripts/db/cron.sql), so either path is enough.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new NextResponse("Unauthorized", { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("run_pip_escalations");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, escalations: data ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
