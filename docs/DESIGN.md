# Interface design

One calm system, applied the same way on every screen. The pieces live in `lib/ui/index.tsx`; the tokens in `app/globals.css`.

## Principles

1. **Home says what needs you.** Each role's home page is a short list of actions with one button each, the next dates, and a single row of counts. Full tables live on Reviews, Programs, and Improvement plans.
2. **Navigation is grouped by kind of work.** A sidebar with Work, Setup, and Administration for ALSDE staff; My system for districts. Each role sees only its groups. The current page is marked.
3. **Forms open on request.** Anything that adds a record sits behind a button (`Disclosure`). A page shows what exists first.
4. **Tables carry few columns.** Codes are small and grey beside names (`Code`). Status is one column. Qualifiers are a quiet line under the name, not a row of badges.
5. **One sentence per header.** A page header has an eyebrow (where you are), a title, and at most one sentence.

## Tokens

- Ink `#1b2430`, muted `#5b6672`, faint `#8a939d`.
- Paper `#f4f3ee` for the page, white surfaces, raised surface `#fbfaf7` for form panels and table heads.
- Brand green `#0f5e4e`, sidebar green `#0b3d33`, soft green `#e6f0ec`.
- Accent gold `#b8860b` for the current item, focus ring, and attention dots. Used sparingly.
- Warning, danger, and success each have a text color and a soft background, never used for decoration.
- Type: the system sans stack, 15px body, headings sized once in `globals.css`. Tabular numbers in tables.

## Pieces

`PageHeader`, `Card` (with a header band), `Table`, `Code`, `Badge`, `Empty`, `Alert`, `Disclosure`, `Stat`, `TaskList`, `Facts`, `Button`, `LinkButton`, `TextLink`, and the form controls. Every control has a 44px target and a visible focus ring.

## Checking a screen

The end-to-end suite renders the signed-in shell for a State Admin and a CTE Director against fabricated data (`tests/e2e/shell.spec.ts`). To look at a page while working, build with `npm run build:e2e`, start `node tests/e2e/mock-supabase.mjs` and `npx next start -p 3100`, and sign in by planting the session cookie that `tests/e2e/session.ts` builds.
