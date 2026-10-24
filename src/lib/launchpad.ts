import { db } from "@/db";
import { integrations, websites } from "@/db/schema";

/**
 * The Overview launchpad.
 *
 * Fast access to every account and system the agency runs on, without asking the agent.
 * Links are derived from the integration registry and the website inventory so they stay
 * accurate when an account is added, renamed or disconnected. No secrets are read here:
 * only labels, base URLs and connection status.
 */

// Local worker runs Qwen 3B; the 7B model is blocked (config/agent-policy.json).
export type LaunchState = "connected" | "disconnected";

export type LaunchLink = {
  label: string;
  href: string;
  meta?: string;
  state?: LaunchState;
  external: boolean;
};

export type LaunchGroup = {
  key: string;
  title: string;
  links: LaunchLink[];
  manageHref?: string;
};

type IntegrationRow = typeof integrations.$inferSelect;
type WebsiteRow = typeof websites.$inferSelect;

const trimSlash = (value: string) => value.replace(/\/+$/, "");

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function configOf(record: IntegrationRow): Record<string, unknown> {
  const config = record.config;
  return config && typeof config === "object" && !Array.isArray(config) ? (config as Record<string, unknown>) : {};
}

function accountsOf(record: IntegrationRow): Array<Record<string, unknown>> {
  const accounts = configOf(record).accounts;
  return Array.isArray(accounts) ? accounts.map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {})) : [];
}

function stateOf(record: IntegrationRow): LaunchState {
  return record.status === "connected" && record.enabled ? "connected" : "disconnected";
}

/** Console URLs and per-account links for every integration in the registry. */
function providerLinks(record: IntegrationRow): LaunchLink[] {
  const base = trimSlash(record.baseUrl ?? "");
  const config = configOf(record);
  const state = stateOf(record);

  switch (record.key) {
    case "github": {
      const accounts = accountsOf(record);
      const owner = text(config.owner);
      const entries = accounts.length ? accounts : [{ label: owner || "GitHub", login: owner }];
      return entries.map((account) => {
        const handle = text(account.owner) || text(account.login) || text(account.label);
        return {
          label: `GitHub ${handle || "account"}`,
          href: handle ? `https://github.com/${handle}` : "https://github.com/settings/repositories",
          meta: text(account.label) && text(account.label) !== handle ? text(account.label) : "repositories",
          state,
          external: true,
        };
      });
    }
    case "vercel": {
      const team = trimSlash(text(config.teamId) || record.baseUrl || "");
      return [{ label: "Vercel", href: team ? `https://vercel.com/${team}` : "https://vercel.com/dashboard", meta: team ? `team ${team}` : "dashboard", state, external: true }];
    }
    case "cloudflare":
      return [{ label: "Cloudflare", href: "https://dash.cloudflare.com/", meta: "DNS · tunnels · zones", state, external: true }];
    case "coolify":
      return [{ label: "Coolify", href: base || "https://studio.merqato.digital", meta: "VPS deployments", state, external: true }];
    case "invoiceshelf":
      return [{ label: "Invoicing", href: base || "https://billing.merqato.digital", meta: "InvoiceShelf · money of record", state, external: true }];
    case "openlivery":
      return [{ label: "OpenLivery", href: process.env.NEXT_PUBLIC_OPENLIVERY_URL || "http://localhost:3000", meta: "AI agent platform", state, external: true }];
    case "ollama":
      return [{ label: "Ollama", href: base || "http://localhost:11434", meta: "local models", state, external: true }];
    case "openrouter":
      return [{ label: "OpenRouter", href: "https://openrouter.ai/activity", meta: "hosted models", state, external: true }];
    case "upcloud":
      return [{ label: "UpCloud", href: "https://hub.upcloud.com/", meta: "VPS host", state, external: true }];
    case "opencode":
      return base ? [{ label: "OpenCode server", href: base, meta: "agent runtime", state, external: true }] : [];
    default:
      return record.baseUrl ? [{ label: record.name, href: base, meta: record.category, state, external: true }] : [];
  }
}

const CODE_KEYS = ["github"];
const HOSTING_KEYS = ["vercel", "coolify", "cloudflare", "upcloud"];
const MONEY_KEYS = ["invoiceshelf"];
const AI_KEYS = ["openlivery", "openrouter", "ollama", "opencode"];

const byConnected = (a: LaunchLink, b: LaunchLink) => Number(b.state === "connected") - Number(a.state === "connected");

function group(key: string, title: string, links: LaunchLink[], manageHref?: string): LaunchGroup {
  return { key, title, links: links.sort(byConnected), manageHref };
}

export type LaunchAccess = { integrations: boolean; websites: boolean; finance: boolean; services: boolean; projects: boolean; clients: boolean };

export async function getLaunchGroups(access: LaunchAccess): Promise<LaunchGroup[]> {
  const [integrationRows, websiteRows] = await Promise.all([
    access.integrations ? db.select().from(integrations) : Promise.resolve<IntegrationRow[]>([]),
    access.websites ? db.select().from(websites) : Promise.resolve<WebsiteRow[]>([]),
  ]);

  const forKeys = (keys: string[]) => integrationRows.filter((row) => keys.includes(row.key)).flatMap(providerLinks);

  const groups: LaunchGroup[] = [];
  const code = forKeys(CODE_KEYS);
  if (code.length) groups.push(group("code", "Code & repositories", code, access.integrations ? "/admin/integrations" : undefined));

  const hosting = forKeys(HOSTING_KEYS);
  if (hosting.length) groups.push(group("hosting", "Hosting & infrastructure", hosting, access.integrations ? "/admin/integrations" : undefined));

  const money = forKeys(MONEY_KEYS);
  if (access.finance) money.push({ label: "Finance", href: "/finance", meta: "invoices · expenses", external: false });
  if (access.clients) money.push({ label: "Clients", href: "/clients", meta: "accounts", external: false });
  if (access.services) money.push({ label: "Services & pricing", href: "/services", meta: "price list", external: false });
  if (money.length) groups.push(group("money", "Money", money));

  if (access.websites) {
    const siteLinks: LaunchLink[] = websiteRows
      .filter((site) => Boolean(site.productionUrl))
      .map((site) => ({
        label: site.name,
        href: site.productionUrl,
        meta: site.status,
        state: site.status === "operational" ? "connected" : "disconnected",
        external: true,
      }));
    siteLinks.push({ label: "Website inventory", href: "/websites", meta: "all sites & links", external: false });
    groups.push(group("websites", "Websites", siteLinks));
  }

  const ai = forKeys(AI_KEYS);
  ai.push({ label: "Agent jobs", href: "/agent", meta: "queue & runs", external: false });
  if (access.projects) ai.push({ label: "Projects", href: "/projects", meta: "delivery", external: false });
  groups.push(group("ai", "Agents & delivery", ai));

  return groups.filter((entry) => entry.links.length > 0);
}
