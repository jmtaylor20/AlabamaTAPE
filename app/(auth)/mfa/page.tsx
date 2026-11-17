import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { MfaFlow } from "./mfa-flow";

export const metadata: Metadata = { title: "Verify it's you" };

export default async function MfaPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  if (user.aal === "aal2") redirect("/app");
  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">TAPE Online</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Verify it&apos;s you</h1>
      <p className="mt-2 text-ink-muted">Signed in as {user.email}. Enter the code from your authenticator app to continue.</p>
      <div className="mt-8">
        <MfaFlow />
      </div>
      <p className="mt-8 text-sm">
        <a href="/auth/sign-out" className="text-brand underline decoration-brand/40 underline-offset-2 decoration-brand/40 underline-offset-2">
          Not you? Sign out
        </a>
      </p>
    </main>
  );
}
