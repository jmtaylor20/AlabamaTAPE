# Phase 6: Communications and calendar

Phase 6 replaces the Outlook templates: every message in the review cycle is drafted from the records, checked by the database for the embargo and the staff-only rule, approved by the State Admin, and then sent from the app or handed to Outlook. The milestone calendar and a personal calendar feed come with it.

## What was built

### Templates
- `email_templates`, one per step: check-in, declaration window, notification, evidence reminder, desk audit, conclusion, PIP follow-up, PIP escalation (staff only), change after notification, reviewer assignment (staff only). Each has an audience (district or staff), To and Cc recipient roles, whether it may go to the district before release, and whether pairings expand.
- Merge fields are written in double braces: system, Director, review month, notification date, visit dates, evidence due, the programs with their reviewers, the teachers with their schools, findings, desk audit text, PIP goals and dates, sender. The notification template follows the structure of the letter in use today: official notice, programs and reviewers, teacher information, key dates, action items, contact, signature.
- Templates are editable by the State Admin on `/app/admin/communications`; every save is a new version and is audited. The dash rule applies to templates.

### Drafts
- `generate_draft(step, lea_review, program_review, pip)` runs in the database: it resolves recipients from the records (Director contacts and accounts, LEA staff, teachers on the selected sites, lead reviewers and reviewers, cluster administrators, State Admins), expands pairings (wherever person A is included, person B is included), merges the fields, and writes an `email_drafts` row. Only the State Admin or a reviewer assigned to the system can generate.
- Two guards run on every insert and update of a draft, by trigger:
  1. A staff-audience draft refuses any district address (approved district domains, LEA contacts, teachers, district accounts).
  2. Before release, a district-audience draft is refused unless the template is allowed before release (check-in, declaration window), and even then its subject and body may not contain a selected program's name, a reviewer's name or address, or the visit date. Unmerged embargoed fields are blanked, never leaked.
- Drafts can be edited until approval by the State Admin or by the reviewer who generated them. Approval and sending are State Admin only. Sending uses Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set; otherwise every draft offers Open in Outlook (a mailto link) and Copy full message, and the State Admin records "sent from Outlook". Drafted, approved, sent, and failed sends are all audited.
- Draft buttons sit where the step happens: the LEA review page (check-in, declaration window, reviewer assignment, notification, evidence reminder, change notice), the review workspace (desk audit, conclusion), and the PIP page (monthly follow-up, escalation).

### Calendar
- `/app/calendar` lists every milestone the caller may see by month, with a filter to the caller's own assignments. District accounts see their own system only, and nothing before release, because the view runs under the caller's policies.
- `/app/calendar.ics` is a personal feed of the same dates for Outlook.

## Pages
| Route | Who | Purpose |
| --- | --- | --- |
| `/app/drafts` and `/app/drafts/[id]` | Staff (State Admin approves and sends) | Review, edit, approve, send, Outlook handoff, discard |
| `/app/admin/communications` | State Admin | Templates and recipient roles |
| `/app/calendar` and `/app/calendar.ics` | Everyone | Milestones in scope |

## Tests
- Policy suite (now 73): before release the notification and the evidence reminder cannot be drafted to the district; the check-in goes to the Director with no program name, reviewer name or address, or visit date, and the State Admin cannot edit those into it; a staff-only draft never includes a district address, even by edit; after release the notification carries programs with reviewers, teachers with schools, key dates, and the paired person, with the Director in To and not in Cc; drafts are read by the State Admin, assigned reviewers, and the cluster administrator only; district roles cannot generate; only the State Admin approves and marks sent; a reviewer can discard only their own unapproved draft; the audit log records drafted, approved, sent.
- Unit suite (now 15): the mailto link and the clipboard text.

## Setup notes
- Migration 0010 applied to the live project with the default templates.
- To send from the app, set `RESEND_API_KEY` and `EMAIL_FROM` (a verified sender on a Taylormade subdomain for the prototype; an ALSDE mailbox later). Until then, use Open in Outlook.
