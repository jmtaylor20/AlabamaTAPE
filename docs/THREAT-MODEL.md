# TAPE Online threat model

Scope: the web application, its database, file storage, email, and the operators. Written against OWASP ASVS Level 2. Reviewed at the end of Phase 7; revisit when a new integration or role is added.

## Assets
| Asset | Why it matters |
| --- | --- |
| Evidence files | District documents; may contain student information despite the warning. FERPA exposure. |
| Scores, findings, PIPs | Determine program standing; must be attributable and immutable once final. |
| Selection and schedule before release | The embargo. Early disclosure undermines the review. |
| Accounts and roles | Every protection depends on who is who. |
| Audit log | The record of who did what; must be complete and unalterable. |
| Message drafts | Carry the same embargoed content and district addresses. |

## Trust boundaries
1. Browser to Netlify (Next.js): anonymous until sign-in; after sign-in, a session cookie.
2. Next.js server to Supabase: the user's own token for every data call; the service role only for storage slots, signed links, scan results, and the scheduled job.
3. Supabase Postgres: row-level security on every table; `security definer` functions carry the rules that need more than one table.
4. Supabase Storage: private bucket, no storage policies, service role only.
5. Resend: receives only approved drafts; no inbound.
6. ClamAV (optional): receives file bytes for scanning inside infrastructure we control.

## Actors
- Outsider with no account. Wants evidence or the selection list.
- District user (Director, LEA staff, teacher). Wants to see another system, see the selection early, change a submitted score, open a quarantined file.
- Staff user (reviewer, cluster administrator, leadership). Wants to score an unassigned review, edit after finalization, read evidence out of scope.
- Compromised account of any kind.
- Operator error (the State Admin or the developer).

## Controls by threat
| Threat | Control | Where it is tested |
| --- | --- | --- |
| Self-registration or sign-in from an unapproved address | Trigger on `auth.users` requires an open invitation on an approved domain | `foundation.test.ts` sign-up gate; live trigger spec |
| Password or code guessing | Email codes expire in minutes; TOTP required for every account; rate limits on codes per address and per network address; Supabase's own limits | `operations.test.ts` rate limiter |
| Reading data without MFA | Every policy calls `app.authed()`, which requires assurance level 2 and an active profile | `foundation.test.ts` |
| Stolen session | 30-minute idle and 8-hour absolute limits; cookies HttpOnly, Secure, SameSite; deactivation bans the account's sessions | `proxy.ts`; deactivation test |
| Cross-LEA reads | Policies key on role grants per LEA; teachers scoped to their declared programs | `evidence.test.ts`, `cycles.test.ts` |
| Embargo breach | District policies on selections, program reviews, assignments, milestones, and sites require `released_at`; draft trigger refuses embargoed text before release | `cycles.test.ts`, `communications.test.ts` |
| Unscanned or infected file opened | Signed link issued only after an `evidence_access` insert the policy allows: scan clean, not quarantined, not removed | `evidence.test.ts` |
| Student data in a file | Upload warning; reviewer quarantine hides the file from district roles; State Admin lifts with reason | `evidence.test.ts` |
| Malware upload | Allowlist by extension and type, byte signature check, test signature check, ClamAV when configured, 40 MB limit, upload rate limit | `evidence-rules.test.ts` |
| Score tampering | Insert-only, versioned entries; finalization locks every write; reopen is State Admin only with reason | `review.test.ts` |
| Finalizing without the meeting or without proof of presence | Database checks the consistency meeting and a TOTP timestamp in the token within ten minutes | `review.test.ts` |
| Audit log tampering | Append-only trigger rejects update and delete; no delete grant | `foundation.test.ts` |
| Staff message leaking to the district | Trigger refuses any district address on a staff-audience draft | `communications.test.ts` |
| Cross-site request forgery | Server actions require same-origin POST (Next.js); SameSite cookies | framework |
| Script injection | React output encoding; strict CSP with no inline scripts; no HTML email bodies | headers spec |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | headers spec |
| Dependency vulnerabilities | `npm audit` at high fails CI; overrides for known advisories | CI |
| Service-role key exposure | Held only in Netlify server environment; never imported by client code; `server-only` guard | code review |
| Leadership reading evidence or finding text | Leadership excluded from file and finding policies; counts come from aggregate functions | `evidence.test.ts`, `operations.test.ts` |
| Loss of data | Supabase daily backups plus the encrypted weekly export and tested restore | `check:backup` in CI |

## Residual risks and recommendations
1. ClamAV is optional in the prototype. Stand up the container before real district evidence is accepted.
2. The onsite checklist queue lives in browser storage. A shared or lost tablet holds those entries until synced; use device passcodes.
3. Signed links last 60 seconds but a downloaded file leaves the system. Policy and training, not code, govern what reviewers do with downloads.
4. Email through Resend is a third party seeing message text. The texts contain program names and schedules, never evidence. Microsoft Graph from an ALSDE mailbox removes the third party.
5. The State Admin role is powerful by design. Keep it to two people, both with hardware or app authenticators, and review the audit log monthly.
6. Retention is reporting only. Destruction needs a defined procedure once the records schedule is confirmed.
