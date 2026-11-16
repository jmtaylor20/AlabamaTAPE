# Phase 4: Review

Phase 4 is the reviewer's side of a program review: the desk audit, reviewer scoring, EPIC descriptors, random audit samples, the onsite checklist, section comments, findings, the consistency meeting gate, finalization with a fresh authenticator check, immutability, reopening, and the report.

## What was built

### Reviewer scoring
- Reviewer scores use the same insert-only, versioned `score_entries` table as Director scores, with `scorer_role = reviewer`. Only a reviewer assigned to the program review (or the State Admin) can insert, and only while the review is not finalized. A Level 1 needs a comment; the comment becomes the finding text.
- District roles cannot read reviewer scores until finalization. Teachers never read scores.
- `app.applicable_qpi_codes(site)` decides in the database which indicators a site must have scored: co-op versus everything else, the dual enrollment scenario 3 subset, and ASE-satisfied items skipped for ASE-accredited programs.

### Desk audit
- One per site. The reviewer drafts initial findings and sends them with `send_desk_audit`, which stamps the time, moves the program review and the LEA review to Desk audit, and logs. The Director sees the text only once sent.

### EPIC
- Requested programs get Met, Not met, or N/A (with a reason) per descriptor, insert-only and versioned like scores.

### Random audits and onsite checklist
- `audit_samples` holds counts only: items sampled and items passed, per indicator and kind (Director assurance, safety exam, CTIP, training agreement, other). There is no column for a name.
- `onsite_checks` is one row per site and sub-item (the 2.1.F and 2.1.G items and 5.2.A). The checklist component saves every tap on the device first, queues anything that cannot be sent, and replays the queue when the connection returns or the page is reopened. The sync state is always shown.

### Consistency meeting and finalization
- `consistency_meetings` per LEA review, recorded by an assigned reviewer or the State Admin on the LEA review page.
- `finalize_program_review` checks, in the database: assigned or State Admin; every applicable indicator carries a reviewer score; a consistency meeting exists for the system; the token carries a TOTP verification from the last ten minutes (`app.fresh_mfa` reads the `amr` claim). It then creates a finding for every current reviewer Level 1, sets `finalized_at`, moves the status to Finalized, records a `finalizations` row with the meeting and the verification time, and logs.
- The step-up page `/app/step-up` re-runs the authenticator challenge; a successful verification refreshes the token's `amr` timestamp. The finalize action sends the user there automatically when the database says the verification is stale.
- Once finalized, every write to scores, EPIC, comments, samples, checks, desk audit, and findings is refused by policy for everyone, the State Admin included. `reopen_program_review` is State Admin only, requires a reason, clears the lock, records a `finalizations` row and a scope change (Director and reviewers to be informed), and logs.

### Findings
- Created at finalization from Level 1 scores, or drafted earlier by the reviewer. Each can be tagged to one teacher. Clearing records who, when, the note, and optionally the evidence file. The Director and LEA staff read findings after finalization; a teacher reads findings for their own program only; leadership reads none (counts arrive with dashboards).

### Report
- `/app/programs/[id]/report` renders the program review report (scores, findings, samples, EPIC, comments, desk audit) from what the caller is allowed to read.
- `/app/programs/[id]/report.pdf` renders the same with React PDF on the server and logs the export.

## Pages
| Route | Who | Purpose |
| --- | --- | --- |
| `/app/programs/[id]/review` | Assigned reviewers, staff in scope | Desk audit, scores, onsite checklist, audit samples, EPIC, comments, findings, finalize or reopen |
| `/app/admin/reviews/[id]` | Staff | Now also records the consistency meeting and links each program to its review |
| `/app/programs/[id]` | District roles | Shows the desk audit once sent and reviewer scores and findings once finalized |
| `/app/programs/[id]/report` and `report.pdf` | Anyone in scope | The report |
| `/app/step-up` | Staff | Fresh authenticator check before finalizing |

## Tests
- Policy suite (now 64): reviewer scoring limited to assigned, unlocked sites; district cannot read reviewer scores before finalization; desk audit reaches the Director only when sent; audit samples and checks hidden from the district until finalization; finalize fails without complete scores, without a meeting, with a stale or absent verification, and for unassigned or district callers; finalize creates findings from Level 1s and records the meeting and verification; every write is refused after finalization, including by the State Admin; the Director and the program's teacher read scores and findings after finalization while another teacher and leadership do not; reopen is State Admin only with a reason, logged, and recorded as a scope change; clearing a finding works after reopen.
- A seed error surfaced by these tests was corrected: 2.1.F was flagged as satisfied by ASE accreditation. It hosts the ASE evidence and is not itself satisfied by it. The flag is false in the seed and in the live project (logged as `instrument.seed_corrected`).

## Setup notes
- Migration 0008 is applied to the live project.
- The fresh-MFA gate reads the `amr` claim Supabase puts in the access token after a TOTP verification. Nothing else is needed.
- The onsite queue lives in the browser's local storage for the device in use; it is not a full offline application. A service worker for a fully offline visit is a later improvement.
