#!/usr/bin/env bash
# Restore an encrypted export into an EMPTY database (a fresh Supabase project or a local Postgres).
#   DATABASE_URL=postgres://...  BACKUP_PASSPHRASE=...  scripts/db/restore.sh tape-YYYYMMDD-HHMM.dump.enc
# Apply supabase/tests/auth_shim.sql first on plain Postgres; on Supabase the auth schema already exists.
# Two messages are expected and ignored: the target's public schema already exists, and a newer
# pg_restore client may SET a parameter an older server does not know. Any other error fails the restore.
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
ignore='schema "public" already exists|unrecognized configuration parameter'
if grep -E "ERROR|FATAL" "$log" | grep -Ev "$ignore" | grep -q .; then
  grep -E "ERROR|FATAL" "$log" | grep -Ev "$ignore" >&2
  echo "restore failed; see messages above" >&2
  exit 1
fi
echo "restored $file"
