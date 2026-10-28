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

On 401/403 errors, report the error and stop. Do not attempt to bypass authentication boundaries or
silently self-escalate.

Finding a missing credential is different from overriding a refusal. If a token is simply absent and
one already exists in the Vault for the service being called, load it and continue. If a provider
rejects a credential that is present, or an endpoint is gated by an access policy, treat that as a
decision and surface it — never route around it by trying other headers, tokens, or accounts.

## Infrastructure Autonomy

Coolify and Cloudflare credentials live in the Vault. Deployments are never automatic: after pushing
to GitHub, tell the user which commit you pushed and **ask before deploying**. Only run `deploy.ps1`
once they confirm, and report the deployment ID and result afterwards.

Confirm with the user before any action that changes a live system — deploys, DNS or cache changes,
environment variables, restarts, rollbacks. Reading state (application list, deployment status, DNS
records) needs no confirmation. If a deploy fails, report the failure and stop; do not retry blindly
or widen the change to make it succeed.

## Infrastructure notes (2026-10-27)

- Hosting is Coolify on the UpCloud VPS. Vercel is disabled by default and is not used for production.
- Ollama is reachable at `https://ollama.merqato.digital` through a Cloudflare tunnel
  (`merqato-ollama-v2`) that runs as a Windows service on the owner's workstation. The tunnel
  ingress sets `httpHostHeader: 127.0.0.1:11434` because Ollama rejects any other Host header.
- The UpCloud and Openlivery integrations are intentionally disabled. Do not configure them.
