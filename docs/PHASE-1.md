# Phase 1: Foundation

Delivered: invitation-only sign-in with multi-factor authentication, roles and seats, LEAs, schools, program catalog, teachers, the append-only audit log, admin and Director screens, and the permission tests that prove the isolation rules.

## How access works

1. A State Admin (or a Director, for teachers and LEA staff in their own system) creates an invitation: email, role, and scope.
2. The invited person signs in with Microsoft, Google, or an emailed code. Supabase creates the auth user, and the database trigger `app.handle_new_user` checks for an open invitation on an approved domain. No invitation, or a wrong domain, aborts the sign-in. There is no self-registration path.
3. On first sign-in the person enrolls an authenticator app. Every later sign-in asks for a code. The session's assurance level becomes `aal2` only after a successful code, and every policy requires `app.authed()`, which is `aal2` plus an active profile. A session without MFA reads nothing.
4. Deactivating an account sets `profiles.status`, which every policy checks, so access ends on the next query. The server action also bans the auth user so refresh tokens stop working.
5. Sessions end after 30 minutes idle or 8 hours total (`proxy.ts`). Finalization step-up (fresh code within 10 minutes) is built into `app.seconds_since_last_auth()` and is used in phase 4.

## Permission tests (tests/policies/foundation.test.ts)

- Sign-up gate: uninvited rejected, wrong domain rejected, accepted invitation creates profile and grant.
- LEA isolation: a Director reads only their LEA's schools, teachers, seats, invitations, and audit events; cannot read, insert, or update in another LEA; cannot invite state roles.
- Teacher scope: reads only their own teacher record; cannot change it; sees no invitations or domains.
- Staff scope: Reviewer reads all teachers, edits none; Leadership reads LEAs, not invitations or grants; State Admin edits everything.
- Session requirements: deactivated account reads nothing; aal1 session reads nothing even for the State Admin; revoked grant stops access.
- Audit log: row changes recorded with the actor; application events recorded for the caller only; no update or delete by anyone, owner included; read scoped by role.

The "Reviewer cannot read an unassigned review" test lands in phase 2 with the review tables.

## Settings to complete in the Supabase dashboard (project tape-online)

These are dashboard settings the connector cannot change.

- Authentication > Providers > Email: keep sign-ups enabled (the database trigger is the gate), OTP expiry 10 minutes.
- Authentication > Providers > Azure: client ID and secret from an Entra app registration (redirect URL `https://kuadkrmpofmfzqyokwqr.supabase.co/auth/v1/callback`, multi-tenant so ALSDE and district Microsoft accounts work).
- Authentication > Providers > Google: client ID and secret from a Google Cloud OAuth client with the same redirect URL.
- Authentication > Sessions: access token expiry 3600 seconds, refresh token rotation on.
- Authentication > SMTP: a custom sender (Resend, Postmark, or Microsoft 365), because the built-in sender allows only a few messages an hour.
- Authentication > URL configuration: site URL `https://alabamatape.netlify.app`, redirect URLs for the Netlify site and deploy previews.

## Netlify

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are set.
- `SUPABASE_SECRET_KEY` must be added as a secret. It is used only to ban a deactivated user's sessions; without it the database still blocks the account and the admin screen says so.

## Bootstrapping the first State Admin

Invitations for the coordinator's ALSDE and Taylormade addresses exist in the live project. For a new environment:

```bash
DATABASE_URL=postgres://... node scripts/db/invite.mjs --email you@alsde.edu --role state_admin --name "Your Name"
```
