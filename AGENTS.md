# AGENTS.md — Palawan Collective Command Center

## Secrets

Never ask the user for a GitHub PAT or API token. Always run `bash scripts/get-token.sh github`
(or `bash scripts/sync-github.sh`) first to load the token from the Merqato Vault
(`/api/agent/vault`) before any `git push` or `gh` command.

Never hardcode a credential in a script. Vault-backed tokens only, and never commit or log a secret.

## Task Routing

Use the local Ollama endpoint for simple, repetitive work (renaming, formatting, trivial scripts).
Use the configured primary model for complex architecture and UI work. OpenRouter keys are **not**
permitted in this workspace.

## Integration Failure Protocol

If an integration test fails with 401, 403, or a missing credential error, immediately attempt to
obtain a valid credential from the Vault or the provider's API using the credentials we already
hold. Do not simply report the error back to the user.

## Infrastructure notes (2026-10-27)

- Hosting is Coolify on the UpCloud VPS. Vercel is disabled by default and is not used for production.
- Ollama is reachable at `https://ollama.merqato.digital` through a Cloudflare tunnel
  (`merqato-ollama-v2`) that runs as a Windows service on the owner's workstation. The tunnel
  ingress sets `httpHostHeader: 127.0.0.1:11434` because Ollama rejects any other Host header.
- The UpCloud and Openlivery integrations are intentionally disabled. Do not configure them.
