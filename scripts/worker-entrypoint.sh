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

if [ -n "${GITHUB_TOKEN:-}" ]; then
  umask 077
  printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > /root/.git-credentials
  git config --global credential.helper store
  echo "[entrypoint] git push credentials configured"
fi

git config --global user.name "${GIT_AUTHOR_NAME:-Palawan Agent}"
git config --global user.email "${GIT_AUTHOR_EMAIL:-agent@merqato.digital}"
git config --global --add safe.directory '*' >/dev/null 2>&1 || true

# Local model access. Both of these used to be configured by hand inside the
# running container, so a rebuild lost them and every local-model job failed.
OPENCODE_CONFIG_DIR=/root/.config/opencode
mkdir -p "$OPENCODE_CONFIG_DIR"
if [ ! -f "$OPENCODE_CONFIG_DIR/opencode.json" ]; then
  cp /app/config/opencode-ollama.json "$OPENCODE_CONFIG_DIR/opencode.json"
  echo "[entrypoint] OpenCode Ollama provider configured"
fi

# Start Ollama when the image carries it. Models are read from /root/.ollama,
# which is the mounted volume, so they survive this container being replaced.
if command -v ollama >/dev/null 2>&1; then
  if curl -sf -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    echo "[entrypoint] ollama already listening"
  else
    OLLAMA_HOST=127.0.0.1:11434 \
    OLLAMA_MAX_LOADED_MODELS=1 \
    OLLAMA_NUM_PARALLEL=1 \
    OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-60s}" \
      nohup ollama serve >/tmp/ollama.log 2>&1 &
    waited=0
    while [ "$waited" -lt 30 ]; do
      if curl -sf -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
        echo "[entrypoint] ollama ready after ${waited}s"
        break
      fi
      waited=$((waited + 1))
      sleep 1
    done
    if [ "$waited" -ge 30 ]; then
      echo "[entrypoint] WARN: ollama did not start; local-model jobs will fail"
    fi
  fi
  if ! ollama list 2>/dev/null | grep -q "qwen2.5-coder:3b"; then
    echo "[entrypoint] WARN: qwen2.5-coder:3b is not in the model volume"
  fi
fi

mkdir -p /workspace

exec node /app/scripts/agent-worker.mjs
