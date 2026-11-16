"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
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

export async function requestEmailCode(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { step: "email", error: "Enter a valid email address." };
  const supabase = await createUserClient();
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
