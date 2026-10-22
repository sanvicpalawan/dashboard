#!/usr/bin/env sh
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/merqato-$STAMP.dump"
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$FILE"
sha256sum "$FILE" > "$FILE.sha256"
printf 'Backup created: %s\nChecksum: %s.sha256\n' "$FILE" "$FILE"
printf 'Store both files encrypted off-VPS. A dump is not verified until a separate restore test succeeds.\n'
