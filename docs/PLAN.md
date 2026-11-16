# TAPE Online: Build Plan

Prepared November 16, 2026 for Josh Taylor, ALSDE CTE. Version 1 of the plan, for approval before any code is written.

## 1. What we are building

A secure web application that runs the full TAPE review lifecycle for secondary CTE programs: declarations, selection, scheduling, embargoed notification, continuous evidence collection, Form 14-1, Director self-scoring, desk audit, onsite review, findings, Program Improvement Plans, and year-over-year records. It replaces the master spreadsheet, the Cognia diagnostic, the Outlook templates, and the Form 14-1 Word document.

Version 1 is a prototype that must be credible as production software: real authentication, real row-level security, real audit logging, fabricated data. It runs in a Taylormade account and is built so ALSDE IT can take it over later.

## 2. Architecture

```
Browser (Director, Teacher, Reviewer, Admin; iPad for onsite)
   |  HTTPS, short-lived session, MFA
   v
Next.js 16 app on Netlify (US East)            <- UI, server actions, PDF and spreadsheet export,
   |  service role never reaches the browser       importer, email draft generation, rate limiting
   v
Supabase project (US East, Postgres 17)        <- the system of record
   |-- Postgres with row-level security on every table: the permission model lives here
   |-- Auth: invitation-only, Microsoft and Google sign-in, email code fallback, TOTP MFA
   |-- Storage: private evidence bucket, randomized object names, signed links only
   |-- Edge Functions: upload finalization, scan dispatch, scheduled milestone jobs
   v
ClamAV scanner (small container, US)           <- every upload is scanned before it is viewable
Email provider (Resend, US)                    <- sends only drafts a State Admin approved
```

Three rules shape everything:

1. Every permission is a Postgres policy or function. The app never decides who can see what; it only asks. The same policies apply to the API, exports, and emails because all of them read through the same database roles.
2. Nothing is ever deleted or overwritten. Scores, findings, declarations, and schedules are insert-only with a current-row view. Deletions set a flag. The audit log table accepts inserts only.
3. The instrument is data. QPI text, descriptors, EPIC descriptors, sub-items, thresholds, checklists, and N/A rules live in versioned tables keyed to a school year. A review is bound to the version it was scored under.

## 3. Stack recommendation and reasons

| Layer | Choice | Why | Handoff path |
|---|---|---|---|
| Database and auth | Supabase (Postgres 17, US East) | Row-level security is the requirement, not a feature. Supabase is plain Postgres with auth, storage, and signed URLs attached, and you already run four projects on it, so there is no new vendor. | Postgres dumps restore to Azure Database for PostgreSQL unchanged. Supabase is open source and can be self-hosted in ALSDE's cloud. |
| Web app | Next.js 16, TypeScript, React 19 | Server actions keep secrets server-side, the App Router renders per-user pages, and the team already deploys Next.js. | Container or Azure App Service. |
| Hosting | Netlify (your existing Pro team, US East functions) | Already paid for, already connected to the repo, no new bill. | Any Node host. |
| Sign-in | Supabase Auth: Microsoft (multi-tenant Entra app registration owned by Taylormade for now), Google, and email one-time code; TOTP MFA required for every account | ALSDE staff sign in with their work accounts today. Most districts have Microsoft or Google accounts. The email code covers the rest. The TOTP requirement is enforced in the database: policies check the session's assurance level, so a session without MFA reads nothing. | Swap the Microsoft registration to ALSDE's tenant; optionally trust Entra MFA instead of TOTP. |
| Files | Supabase Storage, private bucket, S3-compatible API | Signed links expire in 60 seconds and are issued only after a policy check and an audit row. | Objects copy to Azure Blob or S3 with the same keys. |
| Malware scanning | ClamAV in a small container (Fly.io, US) called by an edge function | Files never leave infrastructure we control. Commercial scanning APIs send district files to a third party. | Defender for Storage or the same container in Azure. |
| Email | Resend from a Taylormade subdomain, drafts only until approved | Cheapest way to send approved drafts from the app. A "copy to Outlook" button is also provided for every draft. | Microsoft Graph send from an alsde.edu mailbox. |
| PDF | React PDF (pure JavaScript) | Works inside Netlify functions without a headless browser. Handles the PIP grid and Form 14-1 layouts. | None needed. |
| Spreadsheets | SheetJS for import, ExcelJS for export | Reads the master spreadsheet tabs and PowerSchool declaration exports as they are. | None needed. |
| Offline onsite | Progressive web app with an IndexedDB write queue | Every checklist tap and score is saved locally first and synced when the connection returns. | None needed. |
| Tests | Vitest, Playwright, and a Postgres policy suite that runs the real policies against a local database in CI | The permission tests are the product. They run on every commit. | None needed. |

Cost estimate for the prototype: Supabase Pro 25 dollars a month, Netlify already paid, ClamAV container about 5 dollars a month, Resend free tier, Fly.io free credit. Under 40 dollars a month.

## 4. Data model

Keys follow ALSDE's own codes. A declared program at a school is `system-school-program` (005-0020-99). Teachers, users, and everything else get internal IDs.

### Reference data

| Table | Holds |
|---|---|
| school_years | 2026-2027 and on; start and end dates; current flag |
| clusters | 16 clusters by code and name |
| program_catalog | program code, name, cluster, level (secondary or middle), Cooperative Education flag, active flag |
| leas | three-digit system code, name, type (county, city, charter, community college), active flag |
| schools | four-digit school code within a system, name, type (high school, middle school, career tech center, college) |
| approved_domains | email domain allowed per LEA for invitations |
| holidays | state and federal holidays by date, maintained by the State Admin |

### People and access

| Table | Holds |
|---|---|
| profiles | one row per sign-in account: name, email, status, deactivated timestamp |
| role_grants | user, role, scope (LEA for district roles, cluster for cluster administrators), granted by, valid from and to. A person can hold several grants. |
| invitations | email, role, scope, invited by, expiry, accepted at. Sign-up is rejected unless an open invitation matches the email and an approved domain. |
| staff_pairings | person A, person B, start, end, reason: the "wherever A is included, include B" rule |
| teachers | internal ID, LEA, name, email, optional ALSDE teacher ID |
| teacher_years | teacher, school year, contract type (9 month or extended), first-year flag |

### Declarations

| Table | Holds |
|---|---|
| declaration_imports | LEA, school year, uploaded file, validation report, status |
| declared_programs | LEA, school year, home school, location LEA and school, program code, delivery type (LOCAL, DUAL, ACCESS), dual enrollment scenario 1 to 5, ASE accredited flag, vacant flag, EPIC requested flag, exclusion flags, status |
| declared_program_teachers | declared program to teacher, per year |
| declaration_windows | the one-time review window per LEA per cycle: opened by, opens at, closes at. Outside the window the declaration is read-only. |
| declaration_revisions | every change inside the window: field, before, after, who, when |

Eligibility is computed, not typed: a row is reviewable when delivery type is LOCAL or DUAL with scenario 1, 2, or 3, the location LEA equals the home LEA (or the teacher is the LEA's employee), and no exclusion flag is set. ACCESS rows are not eligible until you say otherwise.

### Instrument

| Table | Holds |
|---|---|
| instrument_versions | school year, level, status (draft, published, retired), published at |
| instrument_sections | version, code (1.1, 2.1, 3.1, 4.1, 5.1, 5.2), title, purpose text |
| qpis | version, section, code (2.1.F), title, descriptor, evidence requirements, applies to (all, Cooperative Education only, all except Cooperative Education), assurance-based flag, onsite flag, per-teacher flag, satisfied-by-ASE flag, included in dual scenario 3 flag, random audit kind |
| qpi_subitems | the checklist lines under a QPI (eleven under 2.1.G), each with its own N/A allowance |
| epic_descriptors | version, section, text |
| scoring_rules | version, rule key, operator, threshold, EPIC threshold. First rule: credential pass rate, greater than or equal, 88, 95. |
| checklist_templates | version, role (Director or reviewer), ordered items from page 1 of the tool |

The 2026-2027 tool is seeded as version 1 from the PDF you provided, with the nine ASE-satisfied QPIs flagged (2.1.F, 3.1.A to E, 4.1.A, 5.1.A, 5.1.B) and 5.1.B pre-marked as N/A-allowed.

### Cycles, selection, scheduling

| Table | Holds |
|---|---|
| review_cycles | school year, selection strategy name, target percent (25), settings |
| compliance_list | cycle, LEA, review month, compliance week, imported from the Schedule tab, editable |
| lea_reviews | cycle, LEA, state (declared, checked in, selected, scheduled, released, evidence due, desk audit, onsite, post-visit, concluded), carryover flag, first and second choice dates, visit start and end, notes |
| milestones | LEA review, kind (check-in, release, evidence due, visit, ten-day close, PIP start), computed date, override date, override reason, completed at |
| selection_draws | LEA review, strategy, seed, candidate pool snapshot, exclusions with reasons, result, run by, run at |
| selections | LEA review, declared program, method (nominated, random, manual, carryover), nominated by, status, removal reason |
| program_reviews | LEA review, program code, instrument version, EPIC flag, status, visit date, sequence on the day, release status |
| program_review_sites | program review, school, teachers: the scoring unit |
| review_assignments | program review, user, role (lead reviewer, reviewer, cluster administrator), order |
| scope_changes | what changed mid-cycle, reason, who, dependent records updated, people to inform |
| change_log | entity, field, before, after, who, when, reason: covers declarations, selections, schedules, reviewers, contacts |

The embargo is a column: `lea_reviews.released_at`. Every policy that gives a district role access to selections, program reviews, assignments, visit dates, or the milestone list requires that column to be set. Before release, the district API returns declarations and nothing else. Release is a State Admin action that writes the timestamp and an audit row.

### Evidence and annual forms

| Table | Holds |
|---|---|
| evidence_files | LEA, program code, school, school year, random storage key, original name, type, size, hash, uploaded by, scan status (pending, clean, infected, failed), quarantine flag and reason, flagged by |
| evidence_qpi_links | file to QPI code, so one file satisfies several QPIs |
| evidence_access | every signed link issued: file, user, purpose, time |
| form_141 | LEA, program code, school, school year, instrument version, completed by, submitted by, submitted at, TA requested for Level 1 areas, TA requested for new teachers, comments, scanned file for prior years |
| form_141_items | form, QPI code, score (1, 2, N/A), corrective action |
| credential_results | program site, school year, credential name, test takers, passers, source file |

### Scoring, findings, PIPs

| Table | Holds |
|---|---|
| score_entries | program review site, QPI, scorer role (Director or reviewer), value (1, 2, N/A), N/A reason, comment, version number, author, time. Insert-only; a view shows the current entry. |
| section_comments | program review site, section, author role, text |
| epic_scores | program review site, section, descriptor, value (met, not met, N/A) |
| audit_samples | program review site, QPI, kind (assurance, safety exam, CTIP, training agreement), items sampled, items passed, chosen by (system or reviewer), notes. Counts only, never names. |
| onsite_checks | program review site, QPI sub-item, state, device, captured at, synced at |
| desk_audits | program review, initial findings, sent to Director at |
| consistency_meetings | LEA review, date, attendees, notes. Finalization is blocked until one exists. |
| findings | program review site, QPI, text, status (open, cleared), cleared by, cleared at, clearing evidence |
| finalizations | program review, finalized by, step-up verified at, locked. Reopen rows carry a reason. |
| pips | program review, status, ten-day close date, one-year date, created by, closed by, closed at |
| pip_goals | PIP, finding, QPI, action steps, date accomplished, status (10 days, one year, not complete) |
| pip_progress | PIP, month 1 to 12, entered by (reviewer), text, progress lacking flag, Director and teacher notes |
| pip_escalations | PIP, month (6, 9, 11), notified who, when |
| surveys and survey_responses | questions per version, responses per program review by role. Questions are empty until you write them. |

### Communications and audit

| Table | Holds |
|---|---|
| email_templates | step key, subject, body with merge fields, recipient rules, version |
| recipient_rules | per template: roles included, roles excluded, before-release restriction, pairing expansion |
| email_drafts | template, review, merged subject and body, to and cc lists, status (draft, approved, sent, discarded), approved by, sent at, provider message ID |
| audit_events | actor, action, entity, before, after, IP, user agent, time. Insert-only, no update or delete grant to anyone. |
| legacy_reviews | LEA, program, school, year, result, PIP flag, attached report. QPI-level history can be added later if Cognia exports it. |
| retention_policies | record class, years after close, eligible flag only; destruction is a State Admin action |

## 5. Permission matrix

Scope abbreviations: Own LEA means rows whose LEA matches a role grant. Assigned means rows where the user holds a review assignment. Cluster means program reviews whose program belongs to a cluster the user administers. Released means the LEA review has a release timestamp.

| Resource | State Admin | Cluster Admin | Reviewer | CTE Director | LEA Staff | Teacher | Leadership |
|---|---|---|---|---|---|---|---|
| LEAs, schools, catalog, holidays | Edit | Read | Read | Read own LEA | Read own LEA | Read own | Read |
| Users, invitations, role grants | Edit | Read cluster | None | Invite teachers in own LEA | None | None | None |
| Instrument versions | Edit | Read | Read | Read published | Read published | Read published | Read published |
| Declarations | Edit any | Read cluster | Read assigned LEAs | Edit own LEA inside window, read always | Edit own LEA inside window | Read own programs | Read counts |
| Compliance list, cycles | Edit | Read | Read | None | None | None | None |
| Selections, draws, nominations | Edit, run draws | Read cluster, nominate | Nominate, read assigned | Read own LEA after release | Read own LEA after release | Read own program after release | Read counts |
| Schedules, assignments | Edit | Read cluster | Enter date choices for assigned | Read own LEA after release | Read own LEA after release | Read own after release | None |
| Release | Release, logged | None | None | None | None | None | None |
| Evidence files | Read all, quarantine | Read cluster | Read assigned, flag and quarantine | Upload and read own LEA | Upload and read own LEA | Upload and read own programs | None |
| Form 14-1 | Read all | Read cluster | Read assigned | Complete and submit own LEA | Draft own LEA | Draft own programs | None |
| Director self-scores | Read all, reopen | Read cluster | Read assigned | Enter and submit own LEA | Read own LEA | None | None |
| Reviewer scores, onsite checks, audits | Read all, reopen | Read cluster | Enter for assigned | Read own LEA after conclusion | Read own LEA after conclusion | None | Read aggregates |
| Desk audit, consistency meeting | Edit | Read cluster | Enter for assigned | Read desk audit once sent | Read once sent | None | None |
| Findings | Edit, reopen | Read cluster | Enter and clear for assigned | Read and respond, own LEA | Read own LEA | Read own program | Counts only |
| Finalization | Finalize, reopen with reason | None | Finalize assigned after step-up and consistency meeting | None | None | None | None |
| PIPs | Edit, close | Read cluster, receive escalations | Create, monthly progress, clear, request close for assigned | Add notes and evidence, own LEA | Add notes, own LEA | Add notes and evidence, own program | Status only |
| Email templates and drafts | Edit, approve, send | Read cluster drafts | Read drafts for assigned | None | None | None | None |
| Audit log | Read, export | Own actions | Own actions | Own LEA's actions on own LEA data | None | None | None |
| Dashboards | All | Cluster | Assigned | Own LEA | Own LEA | Own programs | All, no files, no finding text by default |
| Imports and exports | All | Cluster exports | Assigned exports | Own LEA exports | Own LEA exports | None | Dashboard exports |

Two more rules sit above the matrix. First, no row is readable by any role until the session has passed MFA. Second, a deactivated account is blocked at the database the moment the flag is set, because every policy joins to profiles.status.

## 6. Workflow state machine

LEA review states and the dates computed from the review month, all overridable by the State Admin with a reason:

| State | Entered when | Dates computed |
|---|---|---|
| Declared | Declarations imported and confirmed for the year | |
| Listed | LEA appears on the compliance list for the cycle | Review month |
| Selected | Nominations plus the random draw reach the target | |
| Scheduled | First choice date recorded and reviewers assigned | Visit dates, check-in date (20th, two months before), release date (13th of the prior month, or the preceding Friday on a weekend or holiday; two months before for January), evidence due (1st of the review month; the state-set January date), ten-day close (visit end plus ten days), PIP start (day after ten-day close), PIP due (plus twelve months) |
| Checked in | Director confirmed declarations and teacher information | |
| Released | State Admin released the notification | Evidence window opens |
| Evidence due | Director submitted evidence and 2.1.A to D self-scores, or the due date passed | Self-scores freeze |
| Desk audit | Reviewer records initial findings and sends them | |
| Onsite | Visit dates | CTSO season warning for February to April |
| Post-visit | Ten-day window: more evidence accepted, scores finalized after the consistency meeting | |
| Concluded | Scores locked, conclusion notice drafted, survey opened, PIP created for any finding | |

Scope changes (adding or removing programs or reviewers) are allowed in any state after Selected, require a reason, update assignments, drafts, and milestones, and produce a list of people to inform.

## 7. Security controls

- Authentication: invitation only, approved domains per LEA, Microsoft and Google sign-in plus email code, TOTP MFA required for every account and enforced by database policy. Sessions expire after 8 hours and after 30 minutes idle. Finalizing scores requires a fresh MFA verification within the last 10 minutes.
- Authorization: row-level security on every table, policies tested in CI, service role used only inside server functions and never shipped to the browser.
- Files: private bucket, random object names, allowlist of types (PDF, Office documents, images, common video), size limit per file and per program, ClamAV scan before a file becomes viewable, signed links valid for 60 seconds, every link issuance logged. Upload screen shows the student-information warning. Reviewers can flag and quarantine a file; quarantined files are unreadable to district roles.
- Integrity: insert-only scores, findings, declarations, and schedules; soft deletes only; finalized reviews immutable except by a logged State Admin reopen.
- Audit: append-only events for sign-in, file view, upload, score change, finding, release, export, permission change, and every state transition.
- Application: security headers, strict content security policy, same-site cookies and origin checks on every mutation, rate limiting on sign-in and upload, parameterized queries only, output encoding by React, dependency scanning in CI, secrets in Netlify and Supabase environment settings only, a CI check that fails on any em dash or en dash in user-facing text or templates.
- Accessibility: WCAG 2.1 AA, checked with axe in the Playwright suite.
- Retention: configurable per record class, eligibility flag only, destruction by State Admin action. Backup: Supabase daily backups plus a weekly encrypted export to a Taylormade-controlled bucket, with a written restore procedure tested once per phase.

## 8. Imports and exports

Imports, each with a preview and a validation report before anything is written:

- Program catalog, LEAs, and schools from the Program Master, Programs, and District Directory tabs.
- Compliance list from the Schedule tab.
- This year's Cognia program list (27 systems, 93 programs, reviewers, administrators, Directors), creating released LEA reviews with your completion, PIP, and other notes so you can work this year inside the app.
- PowerSchool declaration exports per LEA, opening the one-time review window when you choose.
- Visit scheduling form responses.

Exports: program review report PDF, PIP in the current grid layout, Form 14-1, and spreadsheet export of any list.

## 9. Build phases

Each phase ends with the test suite run, a demo of what works, and a stop for your review.

| Phase | Delivers | Tests that must pass |
|---|---|---|
| 0. Reset | Repo wiped on a fresh branch, new app scaffold, CI, Supabase project, local Postgres test harness, seed data generator | Build, lint, dash check |
| 1. Foundation | Sign-in with MFA, invitations and domains, roles, LEAs, schools, catalog, teachers, audit log, admin screens | A Director cannot read another LEA. A Reviewer cannot read an unassigned review. A Teacher cannot read another program. A deactivated account reads nothing. A session without MFA reads nothing. |
| 2. Instrument and cycles | Versioned instrument seeded from the 2026-2027 tool, school years, declaration import and window with revisions, compliance list, nominations and seeded random draw, scheduling, milestones, holidays, release, this year's Cognia list imported | Embargo: before release, district API responses, exports, and page metadata contain no selection, reviewer, or date. Release is logged. Draw is reproducible from its seed. |
| 3. Evidence and self-scoring | Uploads with scanning and quarantine, multi-QPI links, completeness view, Form 14-1 with four-year history, credential counts, Director scoring and submit | Signed links fail after expiry. Infected and unscanned files are unreadable. Quarantined files are hidden from district roles. |
| 4. Review | Desk audit, onsite checklist with offline queue, reviewer scoring, audit samples, consistency meeting gate, findings, step-up finalization, immutability, report PDF | Finalize fails without a consistency meeting or fresh MFA. Finalized rows reject edits. Reopen requires a reason and is logged. |
| 5. PIPs | PIP creation from findings, goals, monthly progress, clearing, escalations at months 6, 9, 11, close, PIP PDF | Clock starts the day after the ten-day close. Escalations fire on schedule. |
| 6. Communications and calendar | Templates, recipient rules, pairings, draft generation at every step, approval, send or copy to Outlook, milestone calendar | Reviewer-only templates never include district addresses. No draft to a district before release contains embargoed fields. |
| 7. Import, dashboards, security review | Master spreadsheet and scheduling form importers, dashboards, spreadsheet exports, threat model document, backup and restore procedure | Full regression, axe accessibility pass, dependency audit clean |

## 10. Assumptions carried from your answers

These came from your answer sheet as recommendations or items marked CONFIRM. I will build on them unless you change them.

1. Scores are stored per program per school; the LEA-level result is a roll-up.
2. Multiple teachers at one school: one score, with evidence and findings taggable to a teacher.
3. ACCESS rows are not eligible for review.
4. No exclusion for recent review or open PIP; both available as admin flags.
5. Compliance rotation is roughly five years and is imported, not computed.
6. EPIC descriptors score Met, Not Met, or N/A; a finding is only a reviewer score of 1; recommendations on a 2 are comments.
7. Random audits are reviewer-started records; an optional system draw defaults to off.
8. Historical reviews enter as summaries with attached reports.
9. Retention placeholders: 7 years for reviews, findings, PIPs, declarations, and audit logs; 5 years for evidence files.
10. Two State Admins at launch (you and your supervisor), plus a revocable developer role with no evidence access.
11. Leadership sees scores and counts but not evidence or finding text.
12. The TAPE Liaison is the State Admin unless you tell me it is a separate role.
13. Director self-scoring covers 2.1.A to D as required and all other QPIs as optional.
14. A teacher's contract type is entered by the Director each year.
15. The post-review survey ships with an empty question set you fill in later.
