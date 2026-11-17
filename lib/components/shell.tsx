import Link from "next/link";
import type { CurrentUser } from "@/lib/auth/session";
import { SideNav, type NavGroup } from "@/lib/components/side-nav";

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

/** Navigation groups for a role. Each person sees only the groups that hold work for them. */
export function navFor(user: CurrentUser): NavGroup[] {
  const groups: NavGroup[] = [];
  const isDistrict = user.leaIds.length > 0;
  const manages = user.roles.has("cte_director") || user.roles.has("lea_staff");

  if (isDistrict) {
    groups.push({
      label: "My system",
      items: [
        ...(user.isStaff ? [] : [{ href: "/app", label: "Home" }]),
        { href: "/app/programs", label: "Programs" },
        { href: "/app/lea/review", label: "Our review" },
        { href: "/app/pips", label: "Improvement plans" },
        ...(manages ? [{ href: "/app/lea/declarations", label: "Declarations" }] : []),
        { href: "/app/lea", label: manages ? "People and schools" : "My record" },
        { href: "/app/calendar", label: "Calendar" },
      ],
    });
  }
  if (user.isStaff) {
    groups.push({
      label: "Work",
      items: [
        { href: "/app", label: "Home" },
        { href: "/app/reviews", label: "Reviews" },
        { href: "/app/programs", label: "Programs" },
        { href: "/app/pips", label: "Improvement plans" },
        { href: "/app/drafts", label: "Drafts" },
        { href: "/app/calendar", label: "Calendar" },
      ],
    });
  }
  if (user.isStateAdmin) {
    groups.push({
      label: "Setup",
      items: [
        { href: "/app/admin/cycles", label: "Cycles" },
        { href: "/app/admin/declarations", label: "Declarations" },
        { href: "/app/admin/imports", label: "Imports" },
        { href: "/app/admin/leas", label: "Systems" },
        { href: "/app/admin/catalog", label: "Program catalog" },
        { href: "/app/admin/instrument", label: "Instrument" },
        { href: "/app/admin/communications", label: "Message templates" },
      ],
    });
    groups.push({
      label: "Administration",
      items: [
        { href: "/app/admin/users", label: "Users" },
        { href: "/app/admin/audit", label: "Audit log" },
        { href: "/app/admin/settings", label: "Settings" },
      ],
    });
  } else if (user.isStaff) {
    groups.push({ label: "Reference", items: [{ href: "/app/admin/instrument", label: "Instrument" }] });
  }
  if (groups.length === 0) groups.push({ label: "Account", items: [{ href: "/app", label: "Home" }] });
  return groups;
}

export function Shell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const groups = navFor(user);
  const roles = [...user.roles].map(roleLabel).join(", ") || "No role";

  const identity = (
    <div className="flex flex-col gap-2 border-t border-white/15 pt-3 text-sm">
      <div className="min-w-0 px-3">
        <p className="truncate font-semibold text-white">{user.displayName}</p>
        <p className="truncate text-xs text-white/65">{roles}</p>
      </div>
      <div className="flex gap-1 px-3">
        <Link href="/app/account" className="rounded-md px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/8 hover:text-white">
          Account
        </Link>
        <a href="/auth/sign-out" className="rounded-md px-2 py-1 text-xs font-semibold text-white/80 hover:bg-white/8 hover:text-white">
          Sign out
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Sidebar on wide screens. */}
      <aside className="hidden w-64 shrink-0 flex-col bg-brand-ink text-white lg:sticky lg:top-0 lg:flex lg:h-screen">
        <div className="px-6 pb-4 pt-5">
          <Link href="/app" className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-white/60">Alabama State Department of Education</span>
            <span className="mt-1 block text-xl font-semibold tracking-tight text-white">TAPE Online</span>
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <SideNav groups={groups} />
        </div>
        <div className="px-3 pb-4">{identity}</div>
      </aside>

      {/* Compact header with a menu on narrow screens. */}
      <header className="bg-brand-ink text-white lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link href="/app" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">TAPE Online</span>
          </Link>
          <details className="relative">
            <summary className="cursor-pointer rounded-md border border-white/25 px-3 py-1.5 text-sm font-semibold">Menu</summary>
            <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg bg-brand-ink p-3 shadow-lg ring-1 ring-white/15">
              <SideNav groups={groups} />
              <div className="mt-4">{identity}</div>
            </div>
          </details>
        </div>
      </header>

      <div className="min-w-0 flex-1">
        <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
