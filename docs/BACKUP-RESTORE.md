# Backup and restore

## What exists
- Supabase keeps daily backups of the project (point-in-time recovery depends on the plan).
- `scripts/db/backup.sh` makes an encrypted export of the `public` and `app` schemas with `pg_dump`, AES-256 with a passphrase, plus a checksum file. Run it weekly and copy the file to a Taylormade-controlled bucket. The file is useless without the passphrase; keep the passphrase in a password manager, not beside the file.
- `scripts/db/restore.sh` restores an export into an empty database.
- `npm run check:backup` proves the round trip on a throwaway database (seed, export, restore into a second database, compare row counts and policy count). It runs in CI on every push.

## Weekly export
```
export DATABASE_URL='postgres://...'      # the Supabase connection string (session pooler or direct)
export BACKUP_PASSPHRASE='...'            # from the password manager
scripts/db/backup.sh /path/to/exports
```
Copy `tape-YYYYMMDD-HHMM.dump.enc` and its `.sha256` to the bucket. Delete local copies.

Storage objects (evidence files) are not in the database export. Supabase backs up storage separately; for a full off-platform copy, use the Supabase CLI or S3-compatible tooling against the `evidence` bucket with the service key, into an encrypted bucket.

## Restore procedure
1. Create an empty target: a new Supabase project, or local Postgres with `supabase/tests/auth_shim.sql` applied.
2. Verify the checksum and restore:
   ```
   export DATABASE_URL='postgres://...target...'
   export BACKUP_PASSPHRASE='...'
   scripts/db/restore.sh tape-YYYYMMDD-HHMM.dump.enc
   ```
3. On a new Supabase project: apply `scripts/db/storage.sql` and `scripts/db/cron.sql`, configure Auth as in `docs/SUPABASE-AUTH-SETUP.md`, and point Netlify at the new project URL and keys. Users re-enroll their authenticator on first sign-in because authentication data lives in the auth schema, which is not part of this export.
4. Run `npm run test:policies` against a copy to confirm the policies are present (the restore check already counts them).

## Last verified
The round trip runs in CI on every push and was run by hand at the end of Phase 7 with the result: counts matched, 149 policies restored.
