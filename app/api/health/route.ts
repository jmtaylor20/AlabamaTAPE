import { NextResponse } from "next/server";

// Unauthenticated liveness check. Reveals nothing about configuration or data.
export function GET() {
  return NextResponse.json({ ok: true, service: "tape-online" }, { headers: { "Cache-Control": "no-store" } });
}
