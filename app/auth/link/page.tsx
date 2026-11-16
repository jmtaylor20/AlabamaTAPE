import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { completeLinkSignIn } from "@/lib/actions/auth";
import { Button } from "@/lib/ui";

export const metadata: Metadata = { title: "Finish signing in" };

const LINK_TYPES = new Set(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

/**
 * Landing page for an emailed sign-in link. Opening the link does nothing on
 * its own: mail scanners follow links, and a link that signed in on arrival
 * would be spent before the person saw it. The token is used only when the
 * button below is pressed, which sends it in a POST.
 */
export default async function LinkPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const params = await searchParams;
  const tokenHash = params.token_hash?.trim() ?? "";
  const type = params.type?.trim() ?? "email";
  if (!tokenHash || !LINK_TYPES.has(type)) redirect("/sign-in?error=link");
  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs font-semibold uppercase tracking-wide text-brand">TAPE Online</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finish signing in</h1>
      <p className="mt-2 text-ink-muted">Press the button to use your sign-in link. Links work once and expire a few minutes after they are sent.</p>
      <form action={completeLinkSignIn} className="mt-8">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <Button type="submit" className="w-full">
          Continue to TAPE Online
        </Button>
      </form>
      <p className="mt-8 text-sm">
        <a href="/sign-in" className="text-brand underline">
          Request a new code instead
        </a>
      </p>
    </main>
  );
}
