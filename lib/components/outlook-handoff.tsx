"use client";

import { useState } from "react";
import { clipboardText, mailtoHref, type Draft } from "@/lib/email/mailto";
import { Button } from "@/lib/ui";

/** Opens the draft in the user's mail client, and copies the full text in case the client truncates the link. */
export function OutlookHandoff({ draft }: { draft: Draft }) {
  const [copied, setCopied] = useState<string>("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(clipboardText(draft));
      setCopied("Copied. Paste into a new message.");
    } catch {
      setCopied("Could not copy automatically. Select the text below and copy it.");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={mailtoHref(draft)} className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-brand-soft">Open in Outlook</a>
      <Button type="button" variant="secondary" onClick={copy}>Copy full message</Button>
      {copied && <span role="status" className="text-sm text-ink-muted">{copied}</span>}
    </div>
  );
}
