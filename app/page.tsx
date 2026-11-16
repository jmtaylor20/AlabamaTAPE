import Link from "next/link";

export default function Home() {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-brand">Alabama State Department of Education</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">TAPE Online</h1>
      <p className="mt-4 max-w-prose text-ink-muted">
        Quality review of secondary Career and Technical Education programs: declarations, selection, scheduling,
        evidence, scoring, findings, and improvement plans in one secure place. Access is by invitation only.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/sign-in" className="inline-flex min-h-11 items-center rounded-md bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
          Sign in
        </Link>
        <Link href="/api/health" className="inline-flex min-h-11 items-center rounded-md border border-line px-5 text-sm font-semibold text-ink hover:bg-brand-soft">
          Service status
        </Link>
      </div>
      <footer className="mt-16 text-xs text-ink-muted">
        Designed and managed by{" "}
        <a href="https://taylormadegrowth.com" className="underline">
          TaylorMade Brands, LLC
        </a>
      </footer>
    </main>
  );
}
