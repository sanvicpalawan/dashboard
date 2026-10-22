#!/usr/bin/env sh
set -eu
: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${POSTGRES_ADMIN_URL:?Example: postgresql://postgres:password@localhost:5432/postgres}"
TEST_DB="merqato_restore_$(date -u +%s)"
export TARGET_DATABASE_URL="$(printf '%s' "$POSTGRES_ADMIN_URL" | sed 's|/postgres$|/'"$TEST_DB"'|')"
cleanup() { psql "$POSTGRES_ADMIN_URL" -c "DROP DATABASE IF EXISTS $TEST_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
psql "$POSTGRES_ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TEST_DB"
BACKUP_FILE="$BACKUP_FILE" TARGET_DATABASE_URL="$TARGET_DATABASE_URL" sh ./scripts/restore.sh
printf 'Temporary restore verification succeeded; dropping %s.\n' "$TEST_DB"
