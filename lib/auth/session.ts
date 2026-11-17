import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createUserClient } from "@/lib/supabase/server";

export type Role = "state_admin" | "cluster_admin" | "reviewer" | "cte_director" | "lea_staff" | "teacher" | "leadership" | "developer";

export type Grant = { id: string; role: Role; lea_id: string | null; cluster_code: string | null };

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  aal: "aal1" | "aal2";
  /** Unix seconds of the latest authenticator verification in this session's token, if any. */
  mfaVerifiedAt: number | null;
  grants: Grant[];
  roles: Set<Role>;
  leaIds: string[];
  isStaff: boolean;
  isStateAdmin: boolean;
};

export const STAFF_ROLES: Role[] = ["state_admin", "cluster_admin", "reviewer", "leadership"];

/** Loads the signed-in user, their assurance level, and their active role grants. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createUserClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user?.email) return null;

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const aal = (aalData?.currentLevel ?? "aal1") as "aal1" | "aal2";
  const mfaVerifiedAt = (aalData?.currentAuthenticationMethods ?? []).filter((m) => m.method === "totp").reduce<number | null>((latest, m) => (latest === null || m.timestamp > latest ? m.timestamp : latest), null);

  // Before MFA the database returns nothing by design; the shell only needs identity then.
  if (aal !== "aal2") {
    return { id: user.id, email: user.email, displayName: user.email, aal, mfaVerifiedAt, grants: [], roles: new Set(), leaIds: [], isStaff: false, isStateAdmin: false };
  }

  const [{ data: profile }, { data: grants }] = await Promise.all([
    supabase.from("profiles").select("display_name, status").eq("id", user.id).maybeSingle(),
    supabase.from("role_grants").select("id, role, lea_id, cluster_code").eq("user_id", user.id).is("revoked_at", null),
  ]);
  // A deactivated profile is invisible to its own session (policy), so profile is null.
  if (!profile) return null;

  const g = (grants ?? []) as Grant[];
  const roles = new Set(g.map((x) => x.role));
  return {
    id: user.id,
    email: user.email,
    displayName: profile.display_name,
    aal,
    mfaVerifiedAt,
    grants: g,
    roles,
    leaIds: [...new Set(g.map((x) => x.lea_id).filter((x): x is string => !!x))],
    isStaff: STAFF_ROLES.some((r) => roles.has(r)),
    isStateAdmin: roles.has("state_admin"),
  };
});

/** For pages inside the app shell. Redirects to sign-in or MFA when the session is not complete. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (user.aal !== "aal2") redirect("/mfa");
  return user;
}

/** True when the token carries an authenticator verification from the last ten minutes (the finalization gate). */
export function hasFreshMfa(user: CurrentUser, windowSeconds = 600) {
  return user.mfaVerifiedAt !== null && user.mfaVerifiedAt > Math.floor(Date.now() / 1000) - windowSeconds;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.some((r) => user.roles.has(r))) redirect("/app?denied=1");
  return user;
}
