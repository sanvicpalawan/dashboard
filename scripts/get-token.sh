#!/usr/bin/env bash
# Fetch a decrypted token from the Agent Vault
# Usage: VAULT_SECRET=... ./scripts/get-token.sh <integration-key>
# Example: VAULT_SECRET=... ./scripts/get-token.sh github
#
# The vault secret is read from the environment and never hardcoded. Set it in
# the shell, a Coolify environment variable, or an untracked .env file:
#
#   VAULT_SECRET=$(cat ~/.merqato-vault-secret) ./scripts/get-token.sh github
#
# The secret is never logged, and the token goes to stdout so callers can pipe
# it without it reaching a log file.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: VAULT_SECRET=... $0 <integration-key>" >&2
  exit 1
fi

KEY="$1"
VAULT_URL="${VAULT_URL:-https://command.merqato.digital/api/agent/vault}"

if [[ -z "${VAULT_SECRET:-}" ]]; then
  echo "VAULT_SECRET is not set. Export it before running this script; do not hardcode it." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to parse the vault response." >&2
  exit 1
fi

response="$(curl -sf -H "Authorization: Bearer ${VAULT_SECRET}" "${VAULT_URL}?key=${KEY}")" || {
  echo "Vault request failed for key '${KEY}'." >&2
  exit 1
}

token="$(printf '%s' "${response}" | jq -r '.token // empty')"

if [[ -z "${token}" ]]; then
  echo "Vault returned no token for key '${KEY}'." >&2
  exit 1
fi

printf '%s\n' "${token}"
