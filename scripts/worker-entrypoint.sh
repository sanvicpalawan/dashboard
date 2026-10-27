#!/bin/sh
# Entrypoint for the agent worker container.
#
# Credentials arrive as environment variables from Coolify and are written to
# root-only files inside the container. Nothing is baked into the image.
set -eu

if [ -n "${OPENCODE_AUTH_JSON_B64:-}" ]; then
  umask 077
  printf '%s' "$OPENCODE_AUTH_JSON_B64" | base64 -d > /tmp/opencode-auth.json
  OPENCODE_AUTH_JSON_FILE=/tmp/opencode-auth.json
elif [ -n "${OPENCODE_AUTH_JSON:-}" ]; then
  umask 077
  printf '%s' "$OPENCODE_AUTH_JSON" > /tmp/opencode-auth.json
  OPENCODE_AUTH_JSON_FILE=/tmp/opencode-auth.json
fi

if [ -n "${OPENCODE_AUTH_JSON_FILE:-}" ]; then
  if opencode auth import --standalone "$OPENCODE_AUTH_JSON_FILE"; then
    echo "[entrypoint] OpenCode credentials imported"
  else
    echo "[entrypoint] WARN: opencode auth import failed; jobs that need a hosted model will fail"
  fi
  rm -f "$OPENCODE_AUTH_JSON_FILE"
else
  echo "[entrypoint] No OpenCode credentials supplied; only keyless providers will work"
fi

if [ -n "${OLLAMA_API_KEY:-}" ]; then
  # The home-machine Ollama endpoint sits behind a Cloudflare edge rule that only
  # answers requests carrying the stored credential, so the provider config is
  # rendered at start-up rather than baked into the image.
  umask 077
  mkdir -p /root/.config/opencode
  sed -e "s|__OLLAMA_BASE_URL__|${OLLAMA_BASE_URL:-https://ollama.merqato.digital}|g" \
      -e "s|__OLLAMA_API_KEY__|${OLLAMA_API_KEY}|g" \
      /app/config/opencode.worker.json > /root/.config/opencode/opencode.json
  echo "[entrypoint] Ollama provider configured (${OLLAMA_BASE_URL:-https://ollama.merqato.digital})"
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
