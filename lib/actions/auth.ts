"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createUserClient } from "@/lib/supabase/server";

/**
 * Sign-in actions. Supabase creates the auth user on first sign-in; the
 * database trigger rejects anyone without an open invitation on an approved
 * domain, so there is no self-registration path.
 */

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) });
const codeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), code: z.string().trim().regex(/^\d{6,8}$/) });

export type AuthState = { step: "email" | "code"; email?: string; error?: string; notice?: string };

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function friendlyAuthError(message: string) {
  const m = message.toLowerCase();
  if (m.includes("not been invited") || m.includes("not approved") || m.includes("database error saving new user")) {
    return "This email address has not been invited to TAPE Online, or its domain is not approved. Contact the TAPE coordinator.";
  }
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Wait a few minutes and try again.";
  if (m.includes("expired") || m.includes("invalid")) return "That code is not valid or has expired. Request a new one.";
  return "Sign-in failed. Try again, or contact the TAPE coordinator if the problem continues.";
}

function hashKey(value: string) {
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 32);
}

export async function requestEmailCode(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { step: "email", error: "Enter a valid email address." };
  const supabase = await createUserClient();
  // Five codes per address and thirty per network address in fifteen minutes, counted in the database.
  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") ?? h.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim();
  const [byEmail, byIp] = await Promise.all([
    supabase.rpc("consume_rate_limit", { p_key: `otp:email:${hashKey(parsed.data.email)}`, p_max: 5, p_window_seconds: 900 }),
    supabase.rpc("consume_rate_limit", { p_key: `otp:ip:${hashKey(ip)}`, p_max: 30, p_window_seconds: 900 }),
  ]);
  if (byEmail.data === false || byIp.data === false) return { step: "email", error: "Too many sign-in codes requested. Wait fifteen minutes and try again." };
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: `${await siteUrl()}/auth/callback` },
  });
  if (error) return { step: "email", error: friendlyAuthError(error.message) };
  return { step: "code", email: parsed.data.email, notice: "We sent a sign-in code to your email. It expires in a few minutes." };
}

export async function verifyEmailCode(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = codeSchema.safeParse({ email: formData.get("email"), code: formData.get("code") });
  if (!parsed.success) return { step: "code", email: String(formData.get("email") ?? ""), error: "Enter the code from your email." };
  const supabase = await createUserClient();
  const { error } = await supabase.auth.verifyOtp({ email: parsed.data.email, token: parsed.data.code, type: "email" });
  if (error) return { step: "code", email: parsed.data.email, error: friendlyAuthError(error.message) };
  redirect("/mfa");
}

export async function signInWithProvider(formData: FormData) {
  const provider = formData.get("provider");
  if (provider !== "azure" && provider !== "google") redirect("/sign-in");
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${await siteUrl()}/auth/callback`,
      scopes: provider === "azure" ? "email openid profile" : undefined,
    },
  });
  if (error || !data.url) redirect("/sign-in?error=provider");
  redirect(data.url);
}
