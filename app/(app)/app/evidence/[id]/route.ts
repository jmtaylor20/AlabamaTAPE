import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { BUCKET, LINK_TTL_SECONDS } from "@/lib/evidence/rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Opens an evidence file. The database decides: inserting the access row is
 * allowed only when the caller may see the file, the scan is clean, and the
 * file is neither quarantined nor removed. Only then is a 60-second signed
 * link issued, and the access row is the audit record.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.aal !== "aal2") return NextResponse.redirect(new URL("/sign-in", _req.url));
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createUserClient();
  const { data: file } = await supabase.from("evidence_files").select("id, storage_key, original_name, scan_status, quarantined, removed_at").eq("id", id).maybeSingle();
  if (!file) return new NextResponse("Not found", { status: 404 });
  const expires = new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString();
  const { error } = await supabase.from("evidence_access").insert({ file_id: id, user_id: user.id, purpose: "view", expires_at: expires });
  if (error) {
    const why = file.scan_status !== "clean" ? `This file cannot be opened: scan status is ${file.scan_status}.` : file.quarantined ? "This file is quarantined." : "You may not open this file.";
    return new NextResponse(why, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const admin = createAdminClient();
  const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUrl(file.storage_key, LINK_TTL_SECONDS);
  if (signError || !signed) return new NextResponse("Storage is not available right now.", { status: 503 });
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
}
