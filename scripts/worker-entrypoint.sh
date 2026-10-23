#!/bin/sh
# Entrypoint for the agent worker container.
#
# Credentials arrive as environment variables from Coolify and are written to
# root-only files inside the container. Nothing is baked into the image.
set -eu

if [ -n "${OPENCODE_AUTH_JSON:-}" ]; then
  umask 077
  printf '%s' "$OPENCODE_AUTH_JSON" > /tmp/opencode-auth.json
  if opencode auth import --standalone /tmp/opencode-auth.json; then
    echo "[entrypoint] OpenCode credentials imported"
  else
    echo "[entrypoint] WARN: opencode auth import failed; jobs that need a hosted model will fail"
  fi
  rm -f /tmp/opencode-auth.json
else
  echo "[entrypoint] OPENCODE_AUTH_JSON is not set; only keyless providers will work"
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  umask 077
  printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > /root/.git-credentials
  git config --global credential.helper store
  echo "[entrypoint] git push credentials configured"
fi

git config --global user.name "${GIT_AUTHOR_NAME:-Palawan Agent}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-agent@merqato.digital}"
git config --global --add safe.directory '*' >/dev/null 2>&1 || true

mkdir -p /workspace

exec node /app/scripts/agent-worker.mjs
