"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavGroup = { label: string; items: { href: string; label: string }[] };

/** Grouped navigation. The current page is marked by path, with the longest matching link winning. */
export function SideNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const all = groups.flatMap((g) => g.items);
  const current = all.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label="Primary" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="mb-0.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/55">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = current?.href === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-3 py-1.5 text-sm font-medium transition ${active ? "bg-white/12 text-white shadow-[inset_3px_0_0_0_var(--color-accent)]" : "text-white/80 hover:bg-white/8 hover:text-white"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
