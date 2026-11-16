# TAPE Online

Secure web application for the Alabama State Department of Education, Career and Technical Education section, that runs the TAPE review lifecycle: declarations, selection, scheduling, embargoed notification, evidence, Form 14-1, self-scoring, desk audit, onsite review, findings, Program Improvement Plans, and year-over-year records.

The build plan, data model, and permission matrix are in [docs/PLAN.md](docs/PLAN.md).

## Status

Phase 0 (reset and foundation tooling) is complete. Phase 1 (authentication, roles, records, audit log, permission tests) is next.

## Stack

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- Supabase (Postgres 17, Auth, Storage) in US East; all permissions are row-level security policies
- Netlify for hosting
- Vitest for unit tests and a Postgres-backed policy suite that runs the real migrations and policies

## Local development

Requirements: Node 22 or newer, PostgreSQL 16 or newer on the path (for the policy tests only).

```bash
npm ci
cp .env.example .env.local   # fill in the Supabase project values
npm run dev
```

## Checks

```bash
npm run lint           # ESLint
npm run typecheck      # TypeScript
npm run check:dashes   # fails on any em dash or en dash in user-facing text
npm run test:unit      # Vitest unit tests
npm run test:policies  # starts a throwaway Postgres, applies the auth shim and all migrations, runs the policy tests
npm run build
```

`npm run check` runs all of the above except the build. CI runs the same steps on every push.

## Database migrations

Migrations live in `supabase/migrations` and apply in file-name order. Apply them to a project with:

```bash
DATABASE_URL=postgres://... node scripts/db/apply.mjs
```

`supabase/tests/auth_shim.sql` recreates the Supabase auth functions and roles for the local test database only. It is never applied to a Supabase project.

## Rules

- Only fabricated seed data. No real student names, no real district evidence, anywhere in the repository, tests, or logs.
- No em dashes or en dashes in user-facing text, templates, or generated documents.
- Every permission is enforced in the database. The interface only reflects what the database allows.
- Secrets live in `.env.local` and the hosting provider's settings, never in the repository.
