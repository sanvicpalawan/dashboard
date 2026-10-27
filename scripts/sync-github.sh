#!/usr/bin/env bash
# Load GitHub token from Agent Vault and configure git remote for authenticated pushes

set -euo pipefail

TOKEN=$(./scripts/get-token.sh github | jq -r '.token | fromjson | .default')

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "Error: Could not fetch default GitHub token from Vault" >&2
  exit 1
fi

git remote set-url origin "https://x-access-token:${TOKEN}@github.com/sanvicpalawan/dashboard.git"

echo "GitHub token successfully loaded from Vault. Ready to push."