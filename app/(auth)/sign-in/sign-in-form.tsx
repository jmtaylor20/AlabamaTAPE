"use client";

import { useActionState } from "react";
import { requestEmailCode, signInWithProvider, verifyEmailCode, type AuthState } from "@/lib/actions/auth";
import { Alert, Button, Field, Input } from "@/lib/ui";

export function SignInForm({ providerError, linkError, expired }: { providerError: boolean; linkError: string | null; expired: boolean }) {
  const [emailState, emailAction, emailPending] = useActionState(requestEmailCode, { step: "email" } as AuthState);
  const [codeState, codeAction, codePending] = useActionState(verifyEmailCode, { step: "code" } as AuthState);
  const state: AuthState = codeState.error ? codeState : emailState;

  return (
    <div className="flex flex-col gap-6">
      {expired && <Alert tone="warning">Your session ended. Sign in again to continue.</Alert>}
      {providerError && <Alert tone="danger">Sign-in with that provider is not available right now. Use your email instead.</Alert>}
      {linkError !== null && (
        <Alert tone="danger" title="That sign-in link did not work">
          Links work once and expire a few minutes after they are sent. Request a new code below.
          {linkError && <span className="block text-xs text-ink-muted">Details: {linkError}</span>}
        </Alert>
      )}

      <form action={signInWithProvider} className="flex flex-col gap-2">
        <Button name="provider" value="azure" type="submit" variant="secondary" className="w-full">
          Continue with Microsoft
        </Button>
        <Button name="provider" value="google" type="submit" variant="secondary" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
      </div>

      {state.step === "email" ? (
        <form action={emailAction} className="flex flex-col gap-4" aria-busy={emailPending}>
          <Field id="email" label="Email address" error={state.error}>
            <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required aria-describedby={state.error ? "email-error" : undefined} />
          </Field>
          <Button type="submit" disabled={emailPending}>
            {emailPending ? "Sending code" : "Email me a sign-in code"}
          </Button>
        </form>
      ) : (
        <form action={codeAction} className="flex flex-col gap-4" aria-busy={codePending}>
          {state.notice && <Alert tone="info">{state.notice}</Alert>}
          <input type="hidden" name="email" value={state.email ?? emailState.email ?? ""} />
          <Field id="code" label={`Code sent to ${state.email ?? emailState.email}`} error={state.error}>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" required />
          </Field>
          <Button type="submit" disabled={codePending}>
            {codePending ? "Checking" : "Sign in"}
          </Button>
        </form>
      )}
    </div>
  );
}
