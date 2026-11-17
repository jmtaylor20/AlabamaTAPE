import type { Metadata } from "next";
import { MfaFlow } from "@/app/(auth)/mfa/mfa-flow";
import { requireUser } from "@/lib/auth/session";
import { Alert, Card, PageHeader } from "@/lib/ui";

export const metadata: Metadata = { title: "Verify again" };

/** Fresh authenticator check before a finalization. The database refuses to finalize on a token older than ten minutes. */
export default async function StepUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireUser();
  const { next } = await searchParams;
  const target = next && next.startsWith("/app") ? next : "/app";
  return (
    <div className="mx-auto max-w-md">
      <PageHeader eyebrow="Security check" title="Verify again to finalize" description="Finalizing a review locks the scores and findings. Enter the current code from your authenticator app; you then have ten minutes to finalize." />
      <Card>
        <Alert tone="info">This is the same code you use at sign-in. Nothing else changes.</Alert>
        <div className="mt-4"><MfaFlow next={target} stepUp /></div>
      </Card>
    </div>
  );
}
