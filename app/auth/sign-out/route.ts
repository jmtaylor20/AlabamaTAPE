import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  return signOut(request);
}

export async function POST(request: NextRequest) {
  return signOut(request);
}

async function signOut(request: NextRequest) {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  if (data.user) {
    // Best effort: a session that already lost MFA cannot write, and that is fine.
    await supabase.rpc("log_event", { p_action: "auth.sign_out", p_entity_type: "profiles", p_entity_id: data.user.id }).then(() => undefined, () => undefined);
  }
  await supabase.auth.signOut();
  const reason = request.nextUrl.searchParams.get("reason");
  const response = NextResponse.redirect(`${request.nextUrl.origin}/sign-in${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`);
  for (const name of ["tape.session_started", "tape.last_seen"]) response.cookies.set(name, "", { maxAge: 0, path: "/" });
  return response;
}
