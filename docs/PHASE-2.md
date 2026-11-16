# Phase 2: Instrument and cycles

Phase 2 adds everything between "the year starts" and "the system is told who is coming": the versioned instrument, program declarations with a one-time review window, the compliance list and review cycle, nominations and the seeded random draw, scheduling and milestones, reviewer assignments, and the embargoed release.

## What was built

### Versioned instrument
- Tables: `instrument_versions`, `instrument_sections`, `qpis`, `qpi_subitems`, `epic_descriptors`, `scoring_rules`, `checklist_items` (migration 0004).
- The 2026-2027 LEA TAPE Tool (revised March 2, 2026) is loaded from `supabase/seed/instrument-2026-2027.mjs` through `scripts/db/seed-instrument.mjs`: 6 sections, 24 QPIs, 14 sub-items for the onsite safety and facilities items, 23 EPIC descriptors, 8 scoring thresholds, and both checklists.
- Each QPI carries the flags the review logic needs: Director assurance (2.1.A to D), onsite only (2.1.F, 2.1.G), per teacher, satisfied by ASE accreditation, included for dual enrollment scenario 3, random audit kind, and co-op only (5.2.A).
- Once a version is published, a database trigger rejects every change to it. Next year gets a new version; scores always point at the wording the reviewer saw.
- `/app/admin/instrument` shows the published version to staff.

### Declarations
- `declared_programs` (one row per system, school year, home school, program) with delivery type, dual scenario, ASE, vacant, first-year teacher, and EPIC requested, plus `declared_program_teachers`.
- Import: upload a PowerSchool export on `/app/admin/declarations/[lea]`. The file is parsed into a plan (`import_jobs`), shown as a preview with every column match and row problem, and written only when you apply it.
- The one-time window: `/app/admin/declarations/[lea]` opens a `declaration_windows` row with a closing date. While it is open, the Director and LEA staff can edit and add programs on `/app/lea/declarations`; the Director can confirm early. Outside the window the list is read-only for the system, enforced by row-level security, not by the page.
- Every insert, update, and teacher change is written to `declaration_revisions` (append-only) with before and after values, the actor, and the window it happened in. Both the admin page and the Director page show the history.

### Cycles, selection, scheduling, release
- `review_cycles` (one per school year, target percent, January evidence due date), `compliance_list`, `lea_reviews` (status, month, choice dates, visit dates, release), `milestones`, `selection_draws` (append-only), `selections`, `program_reviews`, `review_assignments`, `scope_changes` (append-only), `lea_contacts`.
- Milestone rules live in the database: notification on the 13th of the prior month (two months before for January), moved to the previous Friday on a weekend or holiday; check-in on the 20th two months before; evidence due on the 1st of the review month or the cycle's January date; ten-day close, PIP start, and PIP due from the visit dates.
- Eligibility (`app.declared_program_eligible`): active, not vacant, not first-year, not taught at another system, LOCAL or DUAL scenarios 1 to 3. ACCESS and dual scenarios 4 and 5 are out.
- Target: ceil(eligible x percent), at least one, with a State Admin override that requires a reason and is logged as a scope change. Nominations by reviewers and cluster administrators count toward the target.
- Draw: `app.run_selection_draw(review, seed)` orders the pool by `md5(seed || id)` and takes the remaining slots. The same seed always gives the same result; every draw stores its pool, exclusions, result, and who ran it.
- Release: `app.release_notification` requires at least one program, visit dates, and a reviewer on every program, and only the State Admin can call it. The page asks the admin to type RELEASE. Release is written to the audit log and cannot be undone.
- After release, removing a program, adding or removing a reviewer, or changing the visit dates requires a reason and is recorded in `scope_changes` for the communications phase.

### Embargo
Row-level security is the gate:
- Before release, district roles can read nothing from `lea_reviews`, `milestones`, `selections`, `program_reviews`, or `review_assignments` for their system. The only thing they get is `my_lea_review_summary()`: on the list, the month, and the notification date.
- Reviewers see the systems on the list (so they can nominate and offer dates) but can read program reviews only where they are assigned. Cluster administrators see program reviews in their clusters.
- Leadership sees reviews and counts, never evidence or finding text (those tables arrive in Phases 3 and 4 with the same rule).

### Cognia list import
- `/app/admin/imports/cognia` reads the Cognia TAPE Programs workbook, groups rows by system, and previews what will be created. On apply: systems not on file get a placeholder code (700 and up, flagged `code_is_placeholder`), Directors are stored as `lea_contacts`, every program becomes a released program review with its reviewers (first listed is lead) and cluster administrator assigned by email. Nobody is invited; assignments link to accounts on first sign-in.
- This year's list (27 systems, 93 programs) has been loaded into the live project. Fourteen program names from the list that were not in the catalog were added (codes 26 to 39, placeholder codes until the real ALSDE codes are entered).

## Pages
| Route | Who | Purpose |
| --- | --- | --- |
| `/app/admin/cycles` | State Admin | Cycles per school year |
| `/app/admin/cycles/[id]` | State Admin | Systems in the cycle, add a system |
| `/app/admin/reviews/[id]` | Staff (controls for State Admin) | Milestones, schedule, programs, draw, assignments, release, scope changes |
| `/app/admin/declarations` and `/[lea]` | State Admin | Import, open or close the window, edit, history |
| `/app/admin/imports/cognia` | State Admin | Cognia list preview and apply |
| `/app/admin/instrument` | Staff | The published instrument |
| `/app/reviews` | Staff | My assignments and every system on the list |
| `/app/lea/declarations` | Director, LEA staff | Review and confirm declarations in the window |
| `/app/lea/review` | District roles | Summary before release, full details after |

## Tests
- Policy suite (46 tests, throwaway Postgres): instrument lock, milestone rules including the January and holiday cases, window open and closed, revisions written, teacher scope, target rounding, nominations, reproducible draw, embargo (Director sees nothing before release, summary only), reviewer cannot read an unassigned review, cluster admin scope, release logged, release immutable, import jobs admin only.
- Unit suite: Cognia and declaration parsers.
- Playwright: public pages and headers.

## Not in this phase
- Email delivery of the notification (Phase 6). Release records who, when, and what; the message goes out when communications land.
- Evidence upload, Director self-scoring, and scores (Phase 3).

## Setup notes
- Migrations 0004, 0005, and 0006 are applied to the live project; the instrument is published there.
- The live catalog uses sequential placeholder program codes. Replace them with ALSDE codes before the real declaration import, or the school and program composite identifiers will not line up.
