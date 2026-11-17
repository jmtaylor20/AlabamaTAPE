# Phase 7: Imports, dashboards, exports, security review

## What was built

### Importers
- Master spreadsheet (`/app/admin/imports`): the Program Master, District Directory, Schools, and Schedule tabs in one workbook. Sheets are recognized by their headers. Programs upsert the catalog (new clusters are created as needed); systems upsert by code or name, and a system created from the Cognia list with a placeholder code receives its real ALSDE code here; schools upsert by system and school code; the Schedule tab loads the compliance list into a chosen cycle. Preview first, apply second, everything logged.
- Visit scheduling form responses: a system and two date ranges per row, recorded as the choice dates on the system's review. Released systems are skipped; their dates change on the review page with a reason.
- Both use the same `import_jobs` preview and apply flow as the Cognia and declaration importers.

### Dashboards
- `/app` is now the dashboard. Counts come from `review_counts` and `finding_counts`, which run under the caller's role: leadership sees every program as numbers (statuses, Level 2 and Level 1 counts, open and cleared findings, PIP status) and never a file or a finding's text; cluster administrators see their clusters; reviewers their assignments; Directors and LEA staff their system after release; teachers their own finalized programs.
- Upcoming milestones, open improvement plans and past-due count, drafts waiting for approval (staff), evidence counts (district).

### Exports
- `/app/export/{reviews,programs,findings,pips,drafts,calendar,evidence,audit}.xlsx`. Each runs under the caller's policies, so an export never contains more than the pages show. Leadership's findings export is counts by indicator. Every export is logged with the row count.

### Security controls completed this phase
- Rate limiting in the database: five sign-in codes per address and thirty per network address in fifteen minutes; sixty upload slots per user in ten minutes. Keys are hashed.
- Retention classes with configurable years and an eligibility report on Settings; destruction is not implemented by design.
- Dependency audit clean at every level (the `uuid` advisory under ExcelJS is resolved by an override).
- Threat model: `docs/THREAT-MODEL.md`. Backup and restore: `docs/BACKUP-RESTORE.md`, with the round trip in CI.
- Accessibility: axe WCAG 2.1 AA checks on the public pages in the Playwright suite. Signed-in pages were built with the same component set (labels on every control, 44 px targets, visible focus, skip link, semantic tables with captions, status and alert roles) and should be checked by hand with the axe browser extension once accounts exist.

## Tests
- Policy suite (now 76): rate limiter window and refusal, direct table access denied, retention State Admin only and audited, leadership count functions return nothing outside scope.
- Unit suite (now 18): master sheet recognition and row problems, month parsing, scheduling form parsing.
- End-to-end: public pages plus axe.
- Backup round trip in CI.

## Setup notes
- Migration 0011 applied to the live project.
- Weekly export: schedule `scripts/db/backup.sh` where the passphrase can be kept safely (a Taylormade machine or a small runner), not in Netlify.

## Full regression at the end of Phase 7
| Check | Result |
| --- | --- |
| lint, typecheck, dash check | clean |
| unit tests | 18 passed |
| policy tests | 76 passed |
| end-to-end with axe | passed |
| backup and restore round trip | passed |
| build | clean |
| npm audit (all levels) | 0 findings |
