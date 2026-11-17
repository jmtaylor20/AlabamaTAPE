# Demonstration setup

For showing the app before real data goes in. Everything below is fabricated and is removed before publication.

## The two accounts

- **State Admin**: your ALSDE account, the one with the authenticator already enrolled. Sign in at `/sign-in` with that address and the six-digit emailed code, then the authenticator code.
- **CTE Director**: your second account, switched from State Admin to CTE Director of **Riverbend County** (system 901, a fabricated system from `scripts/db/seed.mjs`). First sign-in with that address enrolls an authenticator app, so have the app ready to scan a second code. Use a private window or a different browser so the two sessions do not share cookies.

To switch the second account back to State Admin, revoke its CTE Director grant and add a State Admin grant under Users, or run the restore statement at the bottom of this page.

## What Riverbend County has

Created by `scripts/db/demo/seed-riverbend.sql`:

- Six declared programs across Riverbend High School and Riverbend Career Technical Center, one of them vacant (so it is out of the pool).
- A place on the December 2026 compliance list, visit December 8 to 9.
- Two selected programs: Welding (nominated) and Health Science (from the draw), each with two fabricated reviewers plus your admin account as a third reviewer so the review workspace opens for you.
- The notification released, with the evidence deadline on December 1.

## A walk-through that fits in ten minutes

1. **Director home**: the system card shows the review month, visit, evidence deadline, and the two programs; the to-do list names the programs not yet submitted.
2. **Programs**: open Welding, upload a file as evidence (needs `SUPABASE_SECRET_KEY` on the site), enter two credential results, mark the four required self-scores, submit.
3. **Our review**: the district view of the release: programs, reviewers, dates.
4. **Admin home**: Riverbend appears in the next 30 days list now, and under Needs you once the visit passes.
5. **Reviews**: Assigned to me lists the two Riverbend programs; open one to score, draft a desk audit, and finalize (finalize asks for a fresh authenticator code).
6. **Drafts**: generate the notification message for Riverbend to show the embargo rules and the Outlook handoff.
7. **Improvement plans**: after a finalize with a Level 1, create the plan and show the twelve-month clock.

## Removing it

Run `scripts/db/demo/teardown-riverbend.sql` as the database owner (the SQL editor in the Supabase dashboard works). It removes the declared programs, the review and everything attached to it, any evidence, scores, findings, drafts, and plans made during the demonstration, and lists any uploaded files left in storage for removal from the dashboard. The system, its schools, and its teachers stay, as the base seed made them.

Then restore the second account's role:

```sql
update public.role_grants set revoked_at = now() where role = 'cte_director' and revoked_at is null
  and lea_id = (select id from public.leas where system_code = '901');
-- and add a State Admin grant for that account under Users, or:
-- insert into public.role_grants (user_id, role) select id, 'state_admin' from public.profiles where email = '<second account address>';
```
