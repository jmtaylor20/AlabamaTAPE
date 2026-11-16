import Link from "next/link";

// Phase 0 placeholder. Phase 1 replaces this with the sign-in flow.
export default function Home() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">Alabama State Department of Education</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">TAPE Online</h1>
      <p className="mt-4 max-w-prose text-ink-muted">
        Quality review of secondary Career and Technical Education programs. Access is by invitation only. Sign-in
        arrives in the next build phase.
      </p>
      <p className="mt-8 text-sm text-ink-muted">
        Build status:{" "}
        <Link href="/api/health" className="text-brand underline">
          health check
        </Link>
      </p>
    </main>
  );
}
