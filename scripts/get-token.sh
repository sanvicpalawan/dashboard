#!/usr/bin/env bash
# Fetch a decrypted token from the Agent Vault
# Usage: ./scripts/get-token.sh <integration-key>
# Example: ./scripts/get-token.sh github

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <integration-key>" >&2
  exit 1
fi

KEY="$1"
VAULT_URL="https://command.merqato.digital/api/agent/vault"
VAULT_SECRET="test-secret-123"

curl -sf -H "Authorization: Bearer ${VAULT_SECRET}" \
  "${VAULT_URL}?key=${KEY}" | jq -r '.token'