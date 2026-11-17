#!/usr/bin/env bash
# Weekly encrypted export of the TAPE Online database.
#   DATABASE_URL=postgres://...  BACKUP_PASSPHRASE=...  scripts/db/backup.sh [out-dir]
# Produces tape-YYYYMMDD-HHMM.dump.enc (custom-format pg_dump, AES-256, PBKDF2).
# Copy the file to the Taylormade-controlled bucket afterward; it is useless without the passphrase.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_PASSPHRASE:?set BACKUP_PASSPHRASE}"
out="${1:-.}"
stamp="$(date -u +%Y%m%d-%H%M)"
file="$out/tape-$stamp.dump.enc"
pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=app "$DATABASE_URL" \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$file"
sha256sum "$file" > "$file.sha256"
echo "wrote $file ($(du -h "$file" | cut -f1))"
