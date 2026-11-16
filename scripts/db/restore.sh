#!/usr/bin/env bash
# Restore an encrypted export into an EMPTY database (a fresh Supabase project or a local Postgres).
#   DATABASE_URL=postgres://...  BACKUP_PASSPHRASE=...  scripts/db/restore.sh tape-YYYYMMDD-HHMM.dump.enc
# Apply supabase/tests/auth_shim.sql first on plain Postgres; on Supabase the auth schema already exists.
# The target's public schema already exists, so that one "already exists" message is expected; any other error fails the restore.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
file="${1:?path to .dump.enc}"
sha256sum -c "$file.sha256"
log="$(mktemp)"
set +e
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file" \
  | pg_restore --no-owner --no-privileges --dbname="$DATABASE_URL" 2> "$log"
set -e
if grep -E "ERROR|FATAL" "$log" | grep -v 'schema "public" already exists' | grep -q .; then
  grep -E "ERROR|FATAL" "$log" | grep -v 'schema "public" already exists' >&2
  echo "restore failed; see messages above" >&2
  exit 1
fi
echo "restored $file"
