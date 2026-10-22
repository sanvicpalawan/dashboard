# Integration configuration

All provider calls run on the Next.js server. Credentials entered in **Admin → Integrations** are encrypted with AES-256-GCM using `CREDENTIAL_ENCRYPTION_KEY` and are never returned to the browser. Test first, then synchronize. Cached records display their fetch time and become explicitly stale after an error.

## GitHub
Each GitHub account is stored as its own encrypted credential with a non-secret label, so `sanvicpalawan`, `merqatodigital` and `digitalnativepalawan` can be tracked side by side. Add an account with its token; the adapter verifies the token against `/user`, records the verified login as the account label, and tags every synchronized record with that account. Use read-only Metadata, Contents, Issues, Pull requests and Actions scopes. Repository owners are resolved as users or organizations. Empty repositories and disabled features are skipped and reported instead of failing the whole sync. Detailed sync covers up to ten repositories per account to bound API usage. Write operations are not enabled.

Signed GitHub webhooks are optionally supported at `/api/webhooks/github?workspace=WORKSPACE_UUID`. Set the same random `GITHUB_WEBHOOK_SECRET` in Command Center and the GitHub webhook, choose `application/json`, and select only required events. The receiver verifies `X-Hub-Signature-256`, rate-limits requests, limits payloads to 1 MB, and stores only action/repository/ref/sender metadata. Raw payloads and secrets are not logged.

## Vercel
Create a read-scoped access token and optionally set a team ID or slug. The adapter calls `/v2/user`, `/v9/projects` and `/v6/deployments`. Team-scoped tokens cannot read the personal `/v2/user` endpoint; in that case the connection test falls back to the team projects endpoint and reports what it could actually see. Vercel may charge for hosting, bandwidth, builds and team features; Command Center does not include Vercel usage in financial metrics. Deployment mutation is not enabled by default.

## Coolify
Enable API access under Coolify settings, restrict allowed IPs where practical, and create a team-scoped **read** token under **Keys & Tokens → API Tokens**. Use the instance root URL (for example `https://coolify.example.com`), not a URL ending in `/api/v1`. The adapter verifies the team identity and lists applications with their status and FQDN; deploy, restart and terminal actions are deliberately not implemented. Coolify is open source; VPS and bandwidth charges remain separate.

## Cloudflare
Create a token with only Zone:Read and DNS:Read for authorized zones. Zone and DNS reads are implemented. DNS writes require a new, separately confirmed adapter and a token with write scope; they are not silently available. Paid Cloudflare plan features are not inferred from zone data.

## InvoiceShelf
InvoiceShelf 2.x has no token screen in its web UI, and its web API authenticates with a Sanctum session. Bearer tokens are issued by the mobile login endpoint, so mint one once and paste it as the credential:

```sh
curl -X POST https://invoices.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"you@example.com","password":"…","device_name":"palawan-command-center"}'
```

The response contains `{ "type": "Bearer", "token": "…" }`. Without that token the instance answers with the SPA HTML instead of JSON, and the connection is reported as unverified rather than silently passing. The adapter reads `/api/v1/invoices`, `/api/v1/customers` and `/api/v1/payments`; verify the mappings against your installed version before treating synchronized values as accounting records. InvoiceShelf is open source; payment gateway charges are external and card data is never stored here.

## OpenCode
OpenCode is the primary coding agent. No Hermes dependency exists. For links only, no server connection is required. For health and session status, explicitly run `opencode serve` on a private interface, set `OPENCODE_SERVER_PASSWORD`, and configure the server root URL plus Basic credentials. The adapter calls `/global/health` and `/session/status`; it does not send prompts or execute tasks. Do not expose a workstation port publicly. Use a private VPS network or authenticated reverse proxy.

## OpenRouter
Use a restricted account API key. The adapter reads `/api/v1/auth/key` and displays only returned usage, limit and remaining-credit fields. Model usage is paid and variable; no pricing or spend is estimated locally.

## Ollama
Use an endpoint reachable from the Command Center server. `/api/tags` supplies model inventory only. Keep Ollama on localhost, a private network, or behind an authenticated proxy; never open a workstation to the public internet for this feature. Remote proxy Bearer credentials are optional.

## UpCloud and monitoring
Use a read-only API sub-account and enter `username:password` as the server-side credential. `/server` supplies inventory, state, zone and plan. It does **not** prove guest CPU, RAM, disk or network observability. Those metrics remain unavailable until a supported monitoring adapter is configured and tested. UpCloud hosting is billed separately.

## Custom JSON and RSS widgets
Add exact hostnames under **Admin → Settings → Approved outbound hosts**. Requests use an 8-second timeout, no redirects, a 2 MB response limit, and field mapping without response-code execution. Private IPs, localhost and `.local` destinations are rejected. A widget may reference an existing server-side integration credential by key; the credential is never placed in widget settings or browser responses.

## Scheduled sync
Manual sync is fully implemented. For scheduled execution, configure a Coolify scheduled task or another trusted worker to call an authenticated internal job runner. The stored sync interval is scheduler configuration, not a claim that a persistent worker is running in the web process.
