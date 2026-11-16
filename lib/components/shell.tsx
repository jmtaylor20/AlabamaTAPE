import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";

const ROLE_LABELS: Record<string, string> = {
  state_admin: "State Admin",
  cluster_admin: "Cluster Administrator",
  reviewer: "Reviewer",
  cte_director: "CTE Director",
  lea_staff: "LEA Staff",
  teacher: "Teacher",
  leadership: "Leadership",
  developer: "Developer",
};

export function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role;
}

export function Shell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const nav: { href: string; label: string }[] = [{ href: "/app", label: "Home" }];
  if (user.leaIds.length) {
    nav.push({ href: "/app/lea", label: "My LEA" }, { href: "/app/programs", label: "Programs" }, { href: "/app/lea/review", label: "My review" });
    if (user.roles.has("cte_director") || user.roles.has("lea_staff")) nav.push({ href: "/app/lea/declarations", label: "Declarations" });
  }
  if (user.isStaff) nav.push({ href: "/app/reviews", label: "Reviews" }, { href: "/app/programs", label: "Programs" });
  if (user.isStateAdmin) {
    nav.push({ href: "/app/admin/cycles", label: "Cycles" }, { href: "/app/admin/declarations", label: "Declarations" }, { href: "/app/admin/leas", label: "LEAs" }, { href: "/app/admin/catalog", label: "Programs" }, { href: "/app/admin/users", label: "Users" }, { href: "/app/admin/audit", label: "Audit log" }, { href: "/app/admin/settings", label: "Settings" });
  }
  if (user.isStaff) nav.push({ href: "/app/admin/instrument", label: "Instrument" });
  nav.push({ href: "/app/account", label: "Account" });

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/app" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">TAPE Online</span>
            <span className="hidden text-xs font-semibold uppercase tracking-wide text-brand sm:inline">Alabama CTE</span>
          </Link>
          <nav aria-label="Primary" className="flex flex-wrap gap-1">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-semibold text-ink hover:bg-brand-soft">
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-muted">
              {user.displayName} <span className="hidden sm:inline">({[...user.roles].map(roleLabel).join(", ") || "no role"})</span>
            </span>
            <a href="/auth/sign-out" className="rounded-md border border-line px-3 py-2 font-semibold hover:bg-brand-soft">
              Sign out
            </a>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
