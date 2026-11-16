import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses row-level security, so it is used only for
 * the few operations the database cannot do for a user: banning a deactivated
 * account's sessions and admin user lookups. Never import this from a client
 * component or expose its results without an authorization check first.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
