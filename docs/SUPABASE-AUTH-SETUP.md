# Supabase Auth setup for TAPE Online

Project: tape-online (`kuadkrmpofmfzqyokwqr`). These are dashboard settings; they cannot be set from the repository.
Without the first two, provider sign-ins bounce to the wrong site and the emailed code never appears.

## 1. URL configuration (Authentication > URL Configuration)

- Site URL: `https://alabamatape.netlify.app`
- Redirect URLs, one per line:
  - `https://alabamatape.netlify.app/auth/callback`
  - `https://deploy-preview-2--alabamatape.netlify.app/auth/callback`
  - `https://*--alabamatape.netlify.app/auth/callback`
  - `http://localhost:3000/auth/callback`

## 2. Email templates (Authentication > Email Templates)

A first sign-in uses the **Confirm signup** template; every later sign-in uses **Magic Link**. Replace both bodies so the message carries the six-digit code and nothing else. No link.

```html
<h2>Sign in to TAPE Online</h2>
<p>Your sign-in code is <strong>{{ .Token }}</strong>. Enter it on the page where you requested it.</p>
<p>The code expires in a few minutes. If you did not request this, ignore this email.</p>
```

Subject: `TAPE Online sign-in code`

### Why there is no link

The state's mail system scans links in incoming email by opening them. In testing it opened the sign-in link within three seconds of delivery, and because Supabase's `{{ .ConfirmationURL }}` completes the sign-in the moment it is opened, the one-time token was spent before the person ever saw the message. A code has to be typed, so a scanner cannot use it.

### If a link is ever added back

Never use `{{ .ConfirmationURL }}`. It points at Supabase's own verify endpoint, which spends the token on a plain GET, before the request reaches this site. Build the link from the token hash instead so it lands on this site's `/auth/link` page, which shows a button and uses the token only when the button is pressed (a POST):

```html
<p><a href="{{ .SiteURL }}/auth/link?token_hash={{ .TokenHash }}&type=email">Sign in to TAPE Online</a></p>
```

For the **Confirm signup** template use `type=signup`. `/auth/callback` also accepts a `token_hash` link and sends it on to `/auth/link` without using it, so an older link style degrades safely. The end-to-end suite checks that opening `/auth/link` makes no call to the identity provider and that pressing the button makes exactly one (`tests/e2e/hydration.spec.ts`).

## 3. Sign-in settings (Authentication > Providers > Email)

- Enable email provider: on
- Allow new users to sign up: on (the database trigger refuses anyone without an invitation)
- Confirm email: on
- Email OTP expiration: 600 seconds
- Email OTP length: 6

## 4. Sessions (Authentication > Sessions)

- Access token (JWT) expiry: 3600 seconds
- Refresh token rotation: on, reuse interval 10 seconds

## 5. SMTP (Authentication > SMTP Settings)

The built-in sender allows only a few emails an hour and is meant for development. Add a custom sender (Resend, Postmark, or Microsoft 365) before anyone else is invited.

## 6. Providers, when ready

- Azure: client ID and secret from an Entra app registration. Redirect URI in Entra: `https://kuadkrmpofmfzqyokwqr.supabase.co/auth/v1/callback`. Choose the multi-tenant account type so ALSDE and district Microsoft accounts can sign in.
- Google: OAuth client ID and secret, authorized redirect URI `https://kuadkrmpofmfzqyokwqr.supabase.co/auth/v1/callback`.
