import type { Metadata } from "next";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string; reason?: string; detail?: string }> }) {
  const params = await searchParams;
  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">Alabama State Department of Education</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">TAPE Online</h1>
      <p className="mt-2 text-ink-muted">Sign in with the email address you were invited with.</p>
      <div className="mt-8">
        <SignInForm providerError={params.error === "provider"} linkError={params.error === "link" ? params.detail ?? "" : null} expired={params.reason === "expired"} />
      </div>
      <p className="mt-10 text-xs text-ink-muted">
        Access is by invitation only. Every account uses multi-factor authentication. Sessions end after 30 minutes without activity.
      </p>
    </main>
  );
}
