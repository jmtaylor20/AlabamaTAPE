# Phase 3: Evidence and self-scoring

Phase 3 adds what the district does between release and the visit: upload evidence against the quality indicators, keep Form 14-1 current with four years of history, enter credential counts, and have the CTE Director self-score and submit.

## What was built

### Evidence files
- Private storage bucket `evidence` (see `scripts/db/storage.sql`). No storage policies exist; only the server's service role reads or writes objects. Keys are random: `system/year/program/uuid.ext`.
- Upload flow: the browser asks the server for a slot (`beginUpload`), which validates the name, type, size, and the program's yearly quota, inserts the `evidence_files` row as pending (policy checked), and returns a one-time signed upload token. The bytes go straight from the browser to storage. Then `completeUpload` downloads the object server-side, hashes it (SHA-256), checks that the bytes match the declared type, looks for the antivirus test signature, calls ClamAV when `CLAMAV_URL` is set, and records the result. Infected objects are deleted from storage; the row stays as the record.
- Opening a file: `/app/evidence/[id]` inserts an `evidence_access` row through the user's own connection. The insert policy allows it only when the caller may see the file, the scan is clean, and the file is neither quarantined nor removed. Only then is a 60-second signed link issued. The access table is append-only and is the audit record of every link.
- Scope (row-level security): State Admin sees everything, including removed files; cluster administrators see their clusters; reviewers see programs they are assigned to this year; the Director and LEA staff see their LEA; a teacher sees only programs they are listed on; leadership sees no files at all. Quarantined files vanish for district roles. Reviewers in scope can quarantine with a reason; only the State Admin lifts a quarantine. Uploaders and the Director can remove a file (soft delete).
- One file can support several indicators (`evidence_qpi_links`) and can be tagged to one teacher.
- Upload screen carries the student-information warning. Accepted types: PDF, Word, Excel, PowerPoint, PNG, JPEG, GIF, HEIC, MP4, MOV, WebM. Limits: 40 MB per file, 1 GB per program per year (constants in `lib/evidence/rules.ts`).

### Director self-scores
- `score_entries` is insert-only and versioned by trigger; `current_scores` shows the latest entry per site, indicator, and role. N/A requires a reason.
- Only the CTE Director inserts Director scores, only after release, only until submission, and only until the evidence due date (or an admin extension). `submit_director_scores` requires a 1 or 2 on 2.1.A to 2.1.D, freezes scores, moves the program review to Evidence submitted, and logs. The State Admin can reopen with a reason and a new date.
- LEA staff read their LEA's scores; teachers never read scores; leadership reads scores.

### Form 14-1
- One form per declared program per year with an item per applicable indicator (Level 1, 2, or N/A plus corrective action), the two technical-assistance requests, and comments. District roles draft, the Director submits (the eGAP attestation stands in for a signature), and a submitted form is frozen until the State Admin reopens it.
- The page shows prior years completed in the app for the same LEA and program and accepts scanned prior-year forms as evidence with a year label, so a review can see the last four years.

### Credential results
- Credential name, test takers, passers, per program per year. Pass rate is compared to the instrument's `credential_pass_rate` rule (88 percent, EPIC 95). Director and LEA staff enter; staff in scope and leadership read.

### Applicability
`lib/instrument/applicability.ts` decides which indicators apply: co-op programs get 5.2.A only; dual enrollment scenario 3 gets the reduced set; ASE-accredited programs show the satisfied-by-ASE items as covered by 2.1.F.

## Pages
| Route | Who | Purpose |
| --- | --- | --- |
| `/app/programs` | Everyone with a program in scope | Programs for the year with evidence counts and Form 14-1 status |
| `/app/programs/[id]` | District roles, staff in scope | Upload, files, links, quarantine, credential counts, indicators with self-scores, submit |
| `/app/programs/[id]/form-14-1` | Same | Draft, submit, reopen, prior years |
| `/app/evidence/[id]` | Same | Opens a file through a 60-second signed link after the policy check |

## Tests
- Policy suite (now 57): LEA isolation for evidence, teacher sees only their own program, teacher cannot upload elsewhere or as someone else, no link while pending or infected, link only when clean, staff scope (assigned reviewer and cluster admin yes; unassigned reviewer and leadership no), quarantine hides and blocks and is logged, only the State Admin lifts it, removed files are admin-only, self-scores insert-only and versioned, N/A needs a reason, submit requires 2.1.A to D and freezes, admin reopen, score visibility by role, Form 14-1 drafting and submission rules, credential scoping.
- Unit suite: allowlist, size limits, byte signature checks, the antivirus test signature, applicability rules.

## Setup notes
- Migration 0007 is applied to the live project; the bucket exists; prior school years 2022-2023 to 2025-2026 were added for the Form 14-1 history.
- `SUPABASE_SECRET_KEY` must be set in Netlify for uploads and links to work. Without it, the upload form explains that storage is not configured.
- `CLAMAV_URL` is optional. Without it, files get the built-in checks and are marked as scanned by `basic`. A ClamAV container is the recommended next step before real district evidence is uploaded.
- Signed links expire after 60 seconds; the expiry is set when the link is issued and enforced by storage.
