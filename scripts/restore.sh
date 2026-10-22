#!/usr/bin/env sh
set -eu
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to an empty restore database}"
: "${BACKUP_FILE:?Set BACKUP_FILE to a verified custom-format dump}"
if [ ! -f "$BACKUP_FILE" ]; then printf 'Backup not found: %s\n' "$BACKUP_FILE"; exit 1; fi
if [ -f "$BACKUP_FILE.sha256" ]; then sha256sum -c "$BACKUP_FILE.sha256"; fi
printf 'This restores into TARGET_DATABASE_URL. It does not drop the database or terminate connections.\n'
printf 'Type RESTORE to continue: '
read -r CONFIRMATION
[ "$CONFIRMATION" = "RESTORE" ] || { printf 'Restore cancelled.\n'; exit 1; }
pg_restore "$TARGET_DATABASE_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error "$BACKUP_FILE"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT count(*) AS users FROM users; SELECT count(*) AS dashboards FROM dashboards; SELECT count(*) AS audit_events FROM audit_events;'
printf 'Restore completed. Verify authentication, dashboard layouts and integration state before switching production.\n'
