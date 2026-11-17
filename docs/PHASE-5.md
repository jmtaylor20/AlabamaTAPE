# Phase 5: Program Improvement Plans

Phase 5 is what happens after a finalized review leaves findings: the PIP, its goals, monthly follow-up, notes and evidence from the district, escalations, and closure.

## What was built

### The PIP
- One PIP per program review, created by an assigned reviewer (or the State Admin) only after finalization. `create_pip` reads the ten-day close from the milestones (visit end plus ten days), starts the clock the next day, sets the one-year completion date twelve months later, creates one goal per open finding, and logs.
- `conclude_program_review` moves a finalized review to Concluded once it has no open findings or a PIP exists for them, and concludes the LEA review when every program is concluded.

### Goals, progress, notes
- `pip_goals`: indicator, action steps, status (accomplished within ten days, within one year, or not complete), and the date. Goals can also be added by hand. Only the assigned reviewer (or the State Admin) writes them, only while the PIP is open.
- `pip_progress`: one entry per month 1 to 12, written by the reviewer, with a lacking-progress flag.
- `pip_notes`: the Director, the program's teacher, and the reviewer add notes, optionally on one goal and optionally attaching evidence already uploaded for the program. Each role can write only as itself; a teacher on another program sees nothing.
- Leadership sees the PIP row (status and dates) and nothing beneath it. Cluster administrators see PIPs in their clusters.

### Escalations
- `run_pip_escalations` records one escalation per open PIP at months 6, 9, and 11 when any goal is still pending or not complete, naming the cluster administrators assigned to the review and the State Admins. Safe to run repeatedly; each month is recorded once. Email delivery arrives with Phase 6; the rows and the audit log are the record now.
- It runs daily inside the database (pg_cron, `scripts/db/cron.sql`, scheduled on the live project at 11:15 UTC), can be called by a scheduler through `POST /api/jobs/pip-escalations` with `CRON_SECRET`, and can be run by hand from the PIPs page by the State Admin.

### Closure
- `close_pip` is State Admin only and needs a closing note. A closed PIP accepts no more goals, progress, or notes.

### PDF
- `/app/programs/[id]/pip.pdf` renders the PIP in the layout of the current spreadsheet: header block (district, program, date, ten-day close, one-year date, closed, reviewer, Director, teachers), the findings grid with the indicator codes highlighted, the goals table with the three date columns and action steps, then a second page for monthly follow-up, notes, escalations, and the closing note. Exports are logged.

## Pages
| Route | Who | Purpose |
| --- | --- | --- |
| `/app/programs/[id]/pip` | Reviewer, staff in scope, Director, LEA staff, the program's teacher | Create, goals, monthly follow-up, notes and evidence, escalations, close |
| `/app/pips` | Same, plus leadership (status only) | Every PIP in scope with the clock, open goals, escalations; State Admin runs the escalation check |
| `/app/programs/[id]/pip.pdf` | Same | The PIP document |

## Tests
- Policy suite (now 68): creation limited to assigned reviewers and the State Admin and blocked before finalization; dates set from the ten-day close; one goal per open finding; conclude requires a PIP when findings are open; goals and progress reviewer-only; Director and teacher notes only as themselves; another teacher and leadership see no goals; cluster admin sees goals; escalations recorded once each at months 6 and 9 with the right recipients, none when goals are accomplished, and only the State Admin may run the check by hand; close is State Admin only with a note; a closed PIP rejects every change; the audit log carries created, escalated, closed.

## Setup notes
- Migration 0009 applied to the live project; the daily pg_cron job is scheduled.
- `CRON_SECRET` is optional; set it only if an external scheduler should call the job route.
