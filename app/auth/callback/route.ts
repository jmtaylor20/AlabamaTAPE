import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Return point for OAuth providers. A provider sends the browser back here
 * with a PKCE `code`, which is exchanged for a session before the MFA step.
 *
 * An emailed link that carries `token_hash` is sent on to /auth/link, which
 * shows a button instead of using the token on arrival. Mail scanners open
 * links; a token spent on a GET would be gone before the person saw it.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = request.nextUrl.origin;

  const providerError = params.get("error_description") ?? params.get("error");
  if (providerError) return NextResponse.redirect(`${origin}/sign-in?error=link&detail=${encodeURIComponent(providerError.slice(0, 120))}`);

  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash && type) {
    const to = new URL("/auth/link", origin);
    to.searchParams.set("token_hash", tokenHash);
    to.searchParams.set("type", type);
    return NextResponse.redirect(to);
  }

  const code = params.get("code");
  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/sign-in?error=link&detail=${encodeURIComponent(error.message.slice(0, 120))}`);
    return NextResponse.redirect(`${origin}/mfa`);
  }

  return NextResponse.redirect(`${origin}/sign-in?error=link`);
}
