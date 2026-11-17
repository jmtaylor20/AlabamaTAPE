import type { BrowserContext } from "@playwright/test";

export const MOCK_URL = process.env.E2E_MOCK_SUPABASE_URL ?? "http://127.0.0.1:3101";
export const ADMIN_ID = "00000000-0000-4000-8000-00000000e2e1";
export const DIRECTOR_ID = "00000000-0000-4000-8000-00000000e2e2";

/**
 * Plants a fabricated Supabase session cookie for the mock identity provider.
 * aal1 is signed in without an authenticator; aal2 has verified one.
 */
export async function signInAs(context: BrowserContext, opts: { sub: string; email: string; aal: "aal1" | "aal2" }) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const amr = opts.aal === "aal2" ? [{ method: "totp", timestamp: now }, { method: "otp", timestamp: now - 60 }] : [{ method: "otp", timestamp: now }];
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: opts.sub, email: opts.email, aud: "authenticated", role: "authenticated", aal: opts.aal, amr, session_id: "00000000-0000-4000-8000-00000000se55", iat: now, exp: now + 3600 })}.e2e-not-a-signature`;
  const session = { access_token: jwt, refresh_token: "e2e-refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: opts.sub, email: opts.email, aud: "authenticated", role: "authenticated" } };
  const ref = new URL(MOCK_URL).hostname.split(".")[0];
  await context.addCookies([{ name: `sb-${ref}-auth-token`, value: `base64-${b64(session)}`, domain: "127.0.0.1", path: "/" }]);
}
