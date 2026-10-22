import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { integrationCache, integrations, websites } from "@/db/schema";

type CachedItem = { id: string; title: string; subtitle?: string; status?: string; meta?: string; url?: string };
type CachedPayload = { items?: CachedItem[] };

export type LiveSource = {
  key: string;
  label: string;
  state: "verified" | "not_connected" | "no_sync" | "error";
  detail: string;
  lastSyncAt: string | null;
};

export type WebsiteLiveRecord = {
  repository?: { title: string; status?: string; url?: string; meta?: string };
  deployment?: { label: string; title: string; status?: string; url?: string; meta?: string };
  matchedBy: "repository-url" | "domain" | "none";
};

export type WebsiteLiveResponse = {
  sources: LiveSource[];
  byWebsite: Record<string, WebsiteLiveRecord>;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseRepo(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const match = raw.match(/github\.com[/:]([^/]+)\/([^/#?]+)/i);
  const path = match ? `${match[1]}/${match[2]}` : raw.replace(/^https?:\/\//i, "").replace(/^github\.com\//i, "");
  return path.replace(/\.git$/i, "").replace(/\/+$/, "").toLowerCase();
}

function hostOf(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function itemsOf(payload: unknown): CachedItem[] {
  const items = (payload as CachedPayload | null)?.items;
  return Array.isArray(items) ? items.filter((item) => typeof item?.id === "string") : [];
}

/** Live repository and deployment status for each website, matched against synchronized integration caches. */
export async function websiteLiveStatus(workspaceId: string): Promise<WebsiteLiveResponse> {
  const [sites, records] = await Promise.all([
    db.select().from(websites).where(eq(websites.workspaceId, workspaceId)),
    db.select().from(integrations).where(and(eq(integrations.workspaceId, workspaceId), inArray(integrations.key, ["github", "vercel", "coolify"]))),
  ]);

  const enabled = records.filter((record) => record.enabled);
  const cacheRows = enabled.length
    ? await db.select().from(integrationCache).where(inArray(integrationCache.integrationId, enabled.map((record) => record.id)))
    : [];

  const sourceFor = (key: string, label: string): LiveSource => {
    const record = enabled.find((entry) => entry.key === key);
    if (!record) return { key, label, state: "not_connected", detail: `${label} is not connected in this workspace.`, lastSyncAt: null };
    const lastSync = record.lastSyncAt ? new Date(record.lastSyncAt).toISOString() : null;
    if (record.status === "error" || record.status === "expired") return { key, label, state: "error", detail: record.lastError || `${label} reported an error.`, lastSyncAt: lastSync };
    if (!lastSync) return { key, label, state: "no_sync", detail: `${label} is connected but has not been synchronized yet.`, lastSyncAt: null };
    return { key, label, state: "verified", detail: `Synchronized ${lastSync.slice(0, 16).replace("T", " ")} UTC.`, lastSyncAt: lastSync };
  };

  const cached = (key: string, resource: string) => {
    const record = enabled.find((entry) => entry.key === key);
    if (!record) return [];
    return cacheRows.filter((row) => row.integrationId === record.id && row.resourceKey === resource).flatMap((row) => itemsOf(row.payload));
  };

  const repositories = cached("github", "repos");
  const applications = cached("coolify", "applications");
  const deployments = cached("vercel", "deployments");
  const projects = cached("vercel", "projects");

  const byWebsite: Record<string, WebsiteLiveRecord> = {};
  for (const site of sites) {
    const repoKey = normaliseRepo(site.repositoryUrl);
    const host = hostOf(site.productionUrl) || hostOf(site.domain);
    const record: WebsiteLiveRecord = { matchedBy: "none" };

    const repo = repoKey
      ? repositories.find((item) => normaliseRepo(item.title) === repoKey || normaliseRepo(item.url) === repoKey)
      : undefined;
    if (repo) {
      record.repository = { title: repo.title, status: repo.status, url: repo.url, meta: repo.meta };
      record.matchedBy = "repository-url";
    }

    const deploymentMatch = host
      ? applications.find((item) => hostOf(item.url) === host) || deployments.find((item) => hostOf(item.url) === host)
      : undefined;
    if (deploymentMatch) {
      const label = applications.includes(deploymentMatch) ? "Coolify" : "Vercel";
      record.deployment = { label, title: deploymentMatch.title, status: deploymentMatch.status, url: deploymentMatch.url, meta: deploymentMatch.meta };
      record.matchedBy = "domain";
    } else if (host) {
      const project = projects.find((item) => normaliseRepo(item.title) === host.split(".")[0]);
      if (project) {
        record.deployment = { label: "Vercel", title: project.title, status: project.status, url: project.url, meta: project.meta };
      }
    }

    byWebsite[site.id] = record;
  }

  return {
    sources: [sourceFor("github", "GitHub"), sourceFor("coolify", "Coolify"), sourceFor("vercel", "Vercel")],
    byWebsite,
  };
}
