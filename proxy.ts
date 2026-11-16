import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every request. Refreshes the Supabase session cookie, enforces the
 * idle timeout, and sends unauthenticated visitors away from the app.
 * Authorization never happens here: the database decides what each session
 * can read. This only decides which screen to show.
 */

const IDLE_MINUTES = 30;
const ABSOLUTE_HOURS = 8;
const PUBLIC_PATHS = ["/", "/sign-in", "/auth/callback", "/auth/sign-out", "/api/health"];

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.includes(path);

  if (!user) {
    if (isPublic) return response;
    const signIn = request.nextUrl.clone();
    signIn.pathname = "/sign-in";
    signIn.search = "";
    return NextResponse.redirect(signIn);
  }

  // Session age limits. Enforced here for the interface; a sign-out clears the cookies.
  const now = Date.now();
  const started = Number(request.cookies.get("tape.session_started")?.value ?? now);
  const lastSeen = Number(request.cookies.get("tape.last_seen")?.value ?? now);
  const expired = now - started > ABSOLUTE_HOURS * 3600_000 || now - lastSeen > IDLE_MINUTES * 60_000;
  if (expired && !isPublic) {
    const out = request.nextUrl.clone();
    out.pathname = "/auth/sign-out";
    out.search = "?reason=expired";
    return NextResponse.redirect(out);
  }
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
  if (!request.cookies.get("tape.session_started")) response.cookies.set("tape.session_started", String(now), cookieOptions);
  response.cookies.set("tape.last_seen", String(now), cookieOptions);

  if (path === "/sign-in" || path === "/") {
    const home = request.nextUrl.clone();
    home.pathname = "/app";
    home.search = "";
    return NextResponse.redirect(home);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|ico|webmanifest)$).*)"],
};
