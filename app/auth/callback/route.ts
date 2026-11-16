import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Return point for OAuth and for emailed links. Handles both link styles
 * Supabase can send: a PKCE `code`, or a `token_hash` with a `type`. Either
 * way the result is a session, and the user goes on to the MFA step.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = request.nextUrl.origin;
  const supabase = await createUserClient();

  const providerError = params.get("error_description") ?? params.get("error");
  if (providerError) return NextResponse.redirect(`${origin}/sign-in?error=link&detail=${encodeURIComponent(providerError.slice(0, 120))}`);

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(`${origin}/sign-in?error=link&detail=${encodeURIComponent(error.message.slice(0, 120))}`);
    return NextResponse.redirect(`${origin}/mfa`);
  }

  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return NextResponse.redirect(`${origin}/sign-in?error=link&detail=${encodeURIComponent(error.message.slice(0, 120))}`);
    return NextResponse.redirect(`${origin}/mfa`);
  }

  return NextResponse.redirect(`${origin}/sign-in?error=link`);
}
