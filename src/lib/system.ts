import { promises as fs } from "node:fs";
import os from "node:os";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { decryptSecret } from "@/lib/security";

/**
 * Host + platform inventory.
 *
 * The dashboard runs on the same VPS as everything else, so the container can
 * read the host's /proc (CPU, memory) and statfs the backing filesystem. Coolify
 * supplies the container inventory. Coolify's own metrics endpoint stays off —
 * we measure the machine directly instead of paying for a metrics agent.
 */

export type HostSnapshot = {
  cpu: { cores: number; percent: number; load: [number, number, number] } | null;
  memory: { totalMb: number; usedMb: number; availableMb: number; percent: number } | null;
  disk: { totalGb: number; usedGb: number; freeGb: number; percent: number } | null;
  uptimeHours: number;
  hostname: string;
  platform: string;
  nodeVersion: string;
};

export type ContainerRow = {
  id: string;
  name: string;
  kind: "application" | "database" | "service";
  status: string;
  url: string | null;
  source: string | null;
  updatedAt: string | null;
};

export type SystemSnapshot = {
  generatedAt: string;
  host: HostSnapshot;
  containers: ContainerRow[];
  coolify: { connected: boolean; baseUrl: string | null; error: string | null };
};

async function readFile(path: string) {
  try {
    return await fs.readFile(path, "utf8");
  } catch {
    return null;
  }
}

function cpuTotals(line: string) {
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  return { idle, total };
}

async function cpuPercent() {
  const first = await readFile("/proc/stat");
  if (!first) return null;
  const before = cpuTotals(first.split("\n")[0]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const second = await readFile("/proc/stat");
  if (!second) return null;
  const after = cpuTotals(second.split("\n")[0]);
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 1000) / 10));
}

async function memorySnapshot() {
  const raw = await readFile("/proc/meminfo");
  if (!raw) return null;
  const value = (key: string) => {
    const match = raw.match(new RegExp(`^${key}:\\s+(\\d+) kB`, "m"));
    return match ? Number(match[1]) : 0;
  };
  const totalKb = value("MemTotal");
  const availableKb = value("MemAvailable") || value("MemFree");
  if (!totalKb) return null;
  const usedKb = Math.max(0, totalKb - availableKb);
  const mb = (kb: number) => Math.round(kb / 1024);
  return {
    totalMb: mb(totalKb),
    usedMb: mb(usedKb),
    availableMb: mb(availableKb),
    percent: Math.round((usedKb / totalKb) * 1000) / 10,
  };
}

async function diskSnapshot() {
  try {
    const stats = await fs.statfs("/");
    const blockSize = Number(stats.bsize);
    const total = Number(stats.blocks) * blockSize;
    const free = Number(stats.bavail) * blockSize;
    if (!total) return null;
    const gb = (bytes: number) => Math.round((bytes / 1024 ** 3) * 10) / 10;
    return { totalGb: gb(total), usedGb: gb(total - free), freeGb: gb(free), percent: Math.round(((total - free) / total) * 1000) / 10 };
  } catch {
    return null;
  }
}

export async function hostSnapshot(): Promise<HostSnapshot> {
  const load = os.loadavg();
  return {
    cpu: {
      cores: os.cpus().length,
      percent: (await cpuPercent()) ?? Math.round((load[0] / Math.max(os.cpus().length, 1)) * 1000) / 10,
      load: [Math.round(load[0] * 100) / 100, Math.round(load[1] * 100) / 100, Math.round(load[2] * 100) / 100],
    },
    memory: await memorySnapshot(),
    disk: await diskSnapshot(),
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    nodeVersion: process.version,
  };
}

type CoolifyConfig = { baseUrl: string; token: string };

async function coolifyConfig(workspaceId: string): Promise<CoolifyConfig | null> {
  const rows = await db.select().from(integrations).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.key, "coolify"))).limit(1);
  const record = rows[0];
  if (!record || !record.baseUrl || !record.credentialEncrypted) return null;
  const raw = decryptSecret(record.credentialEncrypted);
  if (!raw) return null;
  let token = raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const first = Object.values(parsed).find((value) => typeof value === "string" && value.length > 0);
    if (typeof first === "string") token = first;
  } catch {
    // plain token
  }
  return { baseUrl: record.baseUrl.replace(/\/+$/, ""), token };
}

async function coolifyList(baseUrl: string, token: string, path: string): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${baseUrl}/api/v1/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload) ? payload : [];
  } finally {
    clearTimeout(timer);
  }
}

function row(value: unknown, kind: ContainerRow["kind"]): ContainerRow {
  const item = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof item[key] === "string" ? (item[key] as string) : "");
  const fqdn = text("fqdn").split(",")[0].trim();
  const repository = text("git_repository") ? `${text("git_repository")} · ${text("git_branch") || "main"}` : text("image") || text("type");
  return {
    id: text("uuid") || text("id") || text("name"),
    name: text("name") || text("uuid") || "unnamed",
    kind,
    status: text("status") || "unknown",
    url: fqdn ? (fqdn.startsWith("http") ? fqdn : `https://${fqdn}`) : null,
    source: repository || null,
    updatedAt: text("updated_at") || null,
  };
}

export async function systemSnapshot(workspaceId: string): Promise<SystemSnapshot> {
  const host = await hostSnapshot();
  const config = await coolifyConfig(workspaceId);
  if (!config) {
    return { generatedAt: new Date().toISOString(), host, containers: [], coolify: { connected: false, baseUrl: null, error: "No Coolify integration is connected for this workspace." } };
  }
  try {
    const [applications, databases, services] = await Promise.all([
      coolifyList(config.baseUrl, config.token, "applications"),
      coolifyList(config.baseUrl, config.token, "databases").catch(() => []),
      coolifyList(config.baseUrl, config.token, "services").catch(() => []),
    ]);
    const containers = [
      ...applications.map((value) => row(value, "application")),
      ...databases.map((value) => row(value, "database")),
      ...services.map((value) => row(value, "service")),
    ].sort((a, b) => a.name.localeCompare(b.name));
    return { generatedAt: new Date().toISOString(), host, containers, coolify: { connected: true, baseUrl: config.baseUrl, error: null } };
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      host,
      containers: [],
      coolify: { connected: false, baseUrl: config.baseUrl, error: error instanceof Error ? error.message : "Coolify request failed." },
    };
  }
}
