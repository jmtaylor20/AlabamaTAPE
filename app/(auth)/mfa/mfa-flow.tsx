"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Alert, Button, Field, Input } from "@/lib/ui";

type Stage = { kind: "loading" } | { kind: "enroll"; factorId: string; qr: string; secret: string } | { kind: "verify"; factorId: string } | { kind: "error"; message: string };

/**
 * TOTP multi-factor step. First visit enrolls an authenticator app; every later
 * sign-in verifies a code. The session reaches assurance level 2 only after a
 * successful verification, and the database reads nothing until then.
 */
export function MfaFlow() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setStage({ kind: "error", message: "Could not load your authentication settings. Reload the page." });
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setStage({ kind: "verify", factorId: verified.id });
      // Remove any abandoned enrollment before starting a new one.
      for (const f of data.totp.filter((x) => x.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const enroll = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (enroll.error || !enroll.data) return setStage({ kind: "error", message: "Could not start authenticator setup. Reload the page." });
      setStage({ kind: "enroll", factorId: enroll.data.id, qr: enroll.data.totp.qr_code, secret: enroll.data.totp.secret });
    })();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (stage.kind !== "enroll" && stage.kind !== "verify") return;
    setBusy(true);
    setError(null);
    const supabase = createBrowserSupabase();
    const challenge = await supabase.auth.mfa.challenge({ factorId: stage.factorId });
    if (challenge.error || !challenge.data) {
      setBusy(false);
      return setError("Could not start verification. Try again.");
    }
    const verify = await supabase.auth.mfa.verify({ factorId: stage.factorId, challengeId: challenge.data.id, code: code.trim() });
    if (verify.error) {
      setBusy(false);
      return setError("That code did not match. Check your authenticator app and try again.");
    }
    await supabase.rpc("log_event", { p_action: stage.kind === "enroll" ? "auth.mfa_enrolled" : "auth.sign_in", p_entity_type: "profiles" });
    router.replace("/app");
    router.refresh();
  }

  if (stage.kind === "loading") return <p className="text-ink-muted">Loading your authentication settings.</p>;
  if (stage.kind === "error") return <Alert tone="danger">{stage.message}</Alert>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
      {stage.kind === "enroll" && (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <p className="font-semibold">Set up your authenticator app</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
            <li>Open Microsoft Authenticator, Google Authenticator, or another TOTP app.</li>
            <li>Scan this code, or enter the key by hand.</li>
            <li>Type the six-digit code the app shows.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={stage.qr} alt="QR code for your authenticator app" width={180} height={180} className="self-center" />
          <p className="break-all text-center font-mono text-sm">{stage.secret}</p>
        </div>
      )}
      <Field id="totp" label="Six-digit code" error={error ?? undefined}>
        <Input id="totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy || code.trim().length !== 6}>
        {busy ? "Verifying" : stage.kind === "enroll" ? "Finish setup" : "Continue"}
      </Button>
    </form>
  );
}
