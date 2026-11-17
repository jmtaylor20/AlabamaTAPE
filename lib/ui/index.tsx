import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * The interface kit. A small set of accessible pieces that every page is
 * built from, so screens share one rhythm: a page header, sections with a
 * plain title, tables with few columns, forms that open on request, and
 * controls with a visible focus ring and a 44px target.
 */

const base = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
const variants = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-brand-soft",
  danger: "border border-danger bg-surface text-danger hover:bg-danger-soft",
  ghost: "text-brand hover:bg-brand-soft",
};

export function Button({ variant = "primary", className = "", ...props }: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
  return <button type="button" {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

export function LinkButton({ variant = "secondary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: keyof typeof variants }) {
  return <Link {...props} className={`${base} ${variants[variant]} ${className}`} />;
}

/** A plain text link, used inside sentences and table cells. */
export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={`font-semibold text-brand underline decoration-brand/40 underline-offset-2 hover:decoration-brand ${className}`} />;
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: string; error?: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const control = "min-h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus:border-brand";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${control} ${className}`} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select {...props} className={`${control} ${className}`} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${control} min-h-24 py-2 ${className}`} />;
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "success" | "warning" | "danger"; title?: string; children: ReactNode }) {
  const tones = {
    info: "border-brand bg-brand-soft text-ink",
    success: "border-success bg-success-soft text-ink",
    warning: "border-warning bg-warning-soft text-ink",
    danger: "border-danger bg-danger-soft text-ink",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`rounded-md border-l-4 px-4 py-3 text-sm ${tones[tone]}`}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

/** A section of a page. The title sits in a header band so sections read as a list, not as boxes. */
export function Card({ title, actions, description, children, className = "", padded = true }: { title?: string; actions?: ReactNode; description?: string; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-card border border-line bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2 text-sm">{actions}</div>}
        </div>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
      <div>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-brand">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="mt-2 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ caption, head, children }: { caption: string; head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-raised text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">{head}</thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const th = "px-3 py-2.5 font-semibold";
export const td = "px-3 py-2.5 align-top";

/** A program or school code, set small and quiet beside its name. */
export function Code({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs text-ink-muted">{children}</span>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "accent"; children: ReactNode }) {
  const tones = { neutral: "bg-paper text-ink-muted ring-line", good: "bg-success-soft text-success ring-success/20", warn: "bg-warning-soft text-warning ring-warning/20", bad: "bg-danger-soft text-danger ring-danger/20", accent: "bg-accent-soft text-ink ring-accent/30" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${tones[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">{children}</p>;
}

/**
 * A form or detail that stays closed until asked for. The summary is a real
 * button, so keyboard and screen reader users get a disclosure control.
 */
export function Disclosure({ label, children, className = "", open = false, variant = "secondary" }: { label: string; children: ReactNode; className?: string; open?: boolean; variant?: "secondary" | "ghost" }) {
  return (
    <details className={`group ${className}`} open={open}>
      <summary className={`${base} ${variants[variant]} cursor-pointer select-none`}>
        <span aria-hidden="true" className="text-ink-faint transition group-open:rotate-90">&#9656;</span>
        {label}
      </summary>
      <div className="mt-4 rounded-md border border-line bg-surface-raised p-4">{children}</div>
    </details>
  );
}

/** One number with its meaning. Used in a row, never as a wall. */
export function Stat({ value, label, detail, tone = "neutral" }: { value: ReactNode; label: string; detail?: ReactNode; tone?: "neutral" | "accent" | "danger" }) {
  const color = tone === "danger" ? "text-danger" : tone === "accent" ? "text-brand" : "text-ink";
  return (
    <div className="min-w-0">
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
      <p className="text-sm text-ink-muted">{label}</p>
      {detail && <p className="mt-0.5 text-xs text-ink-faint">{detail}</p>}
    </div>
  );
}

/** A list of things that need the reader, each with one link. */
export function TaskList({ items, empty }: { items: { key: string; title: string; detail?: string; href: string; action: string; tone?: "neutral" | "warn" | "bad" }[]; empty: string }) {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <ul className="divide-y divide-line">
      {items.map((t) => (
        <li key={t.key} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="font-semibold">
              {t.tone === "bad" && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-danger align-middle" aria-hidden="true" />}
              {t.tone === "warn" && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-accent align-middle" aria-hidden="true" />}
              {t.title}
            </p>
            {t.detail && <p className="text-sm text-ink-muted">{t.detail}</p>}
          </div>
          <LinkButton href={t.href} className="min-h-9 px-3 text-xs">
            {t.action}
          </LinkButton>
        </li>
      ))}
    </ul>
  );
}

/** A short definition list for facts about one thing. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((f) => (
        <div key={f.label} className="flex flex-col">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{f.label}</dt>
          <dd className="text-ink">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
