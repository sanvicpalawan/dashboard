/**
 * What OpenCode can actually do with each connected provider, as opposed to what
 * the dashboard can display. These two things are not the same and this list is
 * maintained by hand so it never overstates access.
 *
 * access:
 *   direct    - OpenCode can call the provider now, from this machine
 *   dashboard - the dashboard can call it; the agent cannot without a bridge change
 *   blocked   - no working credential exists yet
 *
 * Update `verified` when the entry is re-checked. Never mark an entry direct
 * without a successful request in that session.
 */
export type AgentAccess = {
  key: string;
  access: "direct" | "dashboard" | "blocked";
  permissions: string;
  note: string;
  verified: string | null;
};

export const AGENT_ACCESS: AgentAccess[] = [
  {
    key: "github",
    access: "direct",
    permissions: "Read and write within each stored token's scopes: repositories, issues, pull requests, branches, commits",
    note: "OpenCode already has the gh CLI logins for sanvicpalawan, merqatodigital and digitalnativepalawan, and scripts/integration-request.mjs can call the API with any stored dashboard token.",
    verified: "2026-10-23",
  },
  {
    key: "coolify",
    access: "direct",
    permissions: "Read-only: applications, servers, deployments, teams",
    note: "GET /applications through scripts/integration-request.mjs returned the live application list. The token is read-scoped, so deploys need approval and a differently scoped token.",
    verified: "2026-10-23",
  },
  {
    key: "ollama",
    access: "direct",
    permissions: "Local model inventory and generation",
    note: "Reachable at http://localhost:11434 from this machine and already registered as an OpenCode provider.",
    verified: "2026-10-23",
  },
  {
    key: "opencode",
    access: "direct",
    permissions: "Full task execution on this laptop",
    note: "The dashboard reaches OpenCode through the agent worker, not through an HTTP server. Nothing is exposed to the network.",
    verified: "2026-10-23",
  },
  {
    key: "vercel",
    access: "blocked",
    permissions: "None until a valid token is stored",
    note: "The stored token returns HTTP 403 Not authorized, so no call succeeds. Create a team-scoped token at vercel.com/account/tokens and save it here.",
    verified: "2026-10-23",
  },
  {
    key: "cloudflare",
    access: "blocked",
    permissions: "None until a token is stored",
    note: "No Cloudflare token is available anywhere on this machine. Needs Zone:Read and DNS:Read on account 4322261acf290539b992fbd803039ca7.",
    verified: "2026-10-23",
  },
  {
    key: "upcloud",
    access: "blocked",
    permissions: "None until API credentials are stored",
    note: "No UpCloud API sub-account credentials exist here. Create a read-only API user in the UpCloud control panel.",
    verified: "2026-10-23",
  },
  {
    key: "invoiceshelf",
    access: "blocked",
    permissions: "None until a bearer token is minted",
    note: "InvoiceShelf 2.x has no token screen. POST /api/v1/auth/login with the instance username and password returns a bearer token, which must then be pasted here.",
    verified: "2026-10-23",
  },
  {
    key: "openrouter",
    access: "blocked",
    permissions: "None in the dashboard",
    note: "OpenCode holds its own OpenRouter credential, but the dashboard has no key, so account and credit checks cannot run here.",
    verified: "2026-10-23",
  },
];
