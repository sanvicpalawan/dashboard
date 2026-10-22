import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { checkRateLimit, decryptSecret, encryptSecret, secretHint } from "@/lib/security";
import { publicIntegration, runIntegration } from "@/lib/integration-service";

export const dynamic = "force-dynamic";
const patchSchema = z.object({
  baseUrl: z.string().max(500).nullable().optional(),
  secret: z.string().max(4000).optional(),
  accountId: z.string().max(100).optional(),
  accountLabel: z.string().max(80).optional(),
  enabled: z.boolean().optional(),
  allowedRoles: z.array(z.string().max(100)).max(30).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
const actionSchema = z.object({ action: z.enum(["test", "sync", "disconnect", "remove-account"]), accountId: z.string().max(100).optional(), confirmation: z.string().optional() });

async function find(workspaceId: string, key: string) {
  return (await db.select().from(integrations).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.key, key))).limit(1))[0];
}

/** Decrypted credential map: accountId -> token. Legacy single credentials become `default`. */
function credentialMap(encrypted: string | null): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = decryptSecret(encrypted);
  } catch {
    // Encrypted with a previous key: the owner must store the credential again.
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
    }
  } catch {
    // A plain token saved before named accounts existed.
  }
  return { default: raw };
}

function accountList(config: Record<string, unknown>) {
  return Array.isArray(config.accounts) ? (config.accounts as Record<string, unknown>[]).filter((entry) => entry && typeof entry.id === "string") : [];
}

export async function PATCH(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { user, response } = await apiUser("integrations.manage");
  if (response) return response;
  const key = (await params).key;
  const integration = await find(user.workspaceId, key);
  if (!integration) return Response.json({ error: "Integration not found." }, { status: 404 });
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid integration configuration." }, { status: 400 });
  if ((parsed.data.secret !== undefined || parsed.data.baseUrl !== undefined) && !hasPermission(user, "credentials.manage")) return Response.json({ error: "Credential configuration requires the separate credentials.manage permission." }, { status: 403 });
  if (parsed.data.baseUrl) {
    try { const url = new URL(parsed.data.baseUrl); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { return Response.json({ error: "Instance URL must be a valid HTTP(S) URL without embedded credentials." }, { status: 400 }); }
  }

  const secret = parsed.data.secret?.trim();
  const accounts = accountList(integration.config);
  let credentials = credentialMap(integration.credentialEncrypted);
  let nextAccounts = [...accounts];
  let savedAccountId: string | null = null;

  if (secret) {
    // Replace a specific account, seed the first account, or add another account.
    const targetId = parsed.data.accountId || (Object.keys(credentials).length === 0 ? "default" : `acc_${randomBytes(5).toString("hex")}`);
    credentials = { ...credentials, [targetId]: secret };
    const label = parsed.data.accountLabel?.trim();
    const existing = nextAccounts.find((entry) => entry.id === targetId);
    if (existing) {
      nextAccounts = nextAccounts.map((entry) => entry.id === targetId ? { ...entry, label: label || entry.label || targetId, login: undefined, error: undefined, checkedAt: undefined } : entry);
    } else {
      nextAccounts.push({ id: targetId, label: label || (targetId === "default" ? "Default account" : `Account ${nextAccounts.length + 1}`) });
    }
    savedAccountId = targetId;
  }

  if (parsed.data.accountLabel && !secret && parsed.data.accountId) {
    nextAccounts = nextAccounts.map((entry) => entry.id === parsed.data.accountId ? { ...entry, label: parsed.data.accountLabel!.trim() || entry.label } : entry);
  }

  const config = { ...integration.config, ...(parsed.data.config || {}) } as Record<string, unknown>;
  if (nextAccounts.length) config.accounts = nextAccounts;
  const credentialEncrypted = secret ? encryptSecret(JSON.stringify(credentials)) : integration.credentialEncrypted;

  const [updated] = await db.update(integrations).set({
    baseUrl: parsed.data.baseUrl === undefined ? integration.baseUrl : parsed.data.baseUrl?.replace(/\/$/, "") || null,
    enabled: parsed.data.enabled ?? integration.enabled,
    allowedRoles: parsed.data.allowedRoles ?? integration.allowedRoles,
    config,
    credentialEncrypted,
    credentialHint: secret ? secretHint(secret) : integration.credentialHint,
    status: secret || parsed.data.baseUrl !== undefined ? "disconnected" : integration.status,
    lastError: secret || parsed.data.baseUrl !== undefined ? null : integration.lastError,
    updatedAt: new Date(),
  }).where(eq(integrations.id, integration.id)).returning();
  await audit(user, secret ? "integration.credentials_updated" : "integration.configuration_updated", "integration", integration.id, { provider: key, accountId: savedAccountId, baseUrlChanged: parsed.data.baseUrl !== undefined, enabled: updated.enabled, allowedRoles: updated.allowedRoles });
  return Response.json({ integration: publicIntegration(updated), accountId: savedAccountId });
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { user, response } = await apiUser("integrations.manage");
  if (response) return response;
  const key = (await params).key;
  const rate = checkRateLimit(`integration-action:${user.id}`, 30, 60_000);
  if (!rate.allowed) return Response.json({ error: "Integration action rate limit reached." }, { status: 429 });
  const integration = await find(user.workspaceId, key);
  if (!integration) return Response.json({ error: "Integration not found." }, { status: 404 });
  const parsed = actionSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Unknown integration action." }, { status: 400 });

  if (parsed.data.action === "disconnect") {
    if (!hasPermission(user, "credentials.manage")) return Response.json({ error: "Credential revocation requires credentials.manage." }, { status: 403 });
    if (parsed.data.confirmation !== "DISCONNECT") return Response.json({ error: "Type DISCONNECT to confirm local credential removal." }, { status: 400 });
    const config = { ...integration.config } as Record<string, unknown>;
    delete config.accounts;
    const [updated] = await db.update(integrations).set({ credentialEncrypted: null, credentialHint: null, enabled: false, status: "disconnected", lastError: null, config, updatedAt: new Date() }).where(eq(integrations.id, integration.id)).returning();
    await audit(user, "integration.disconnected", "integration", integration.id, { provider: key, guidance: "Revoke the credential at the provider; local removal does not revoke it remotely." });
    return Response.json({ integration: publicIntegration(updated), guidance: "Local credentials were removed. Revoke the original token in the provider console to complete revocation." });
  }

  if (parsed.data.action === "remove-account") {
    if (!hasPermission(user, "credentials.manage")) return Response.json({ error: "Credential removal requires credentials.manage." }, { status: 403 });
    const accountId = parsed.data.accountId;
    if (!accountId) return Response.json({ error: "Choose which account to remove." }, { status: 400 });
    const credentials = credentialMap(integration.credentialEncrypted);
    delete credentials[accountId];
    const remaining = Object.keys(credentials);
    const originals = accountList(integration.config);
    const nextAccounts = originals.filter((entry) => entry.id !== accountId);
    const config = { ...integration.config, accounts: nextAccounts } as Record<string, unknown>;
    const [updated] = await db.update(integrations).set({
      config,
      credentialEncrypted: remaining.length ? encryptSecret(JSON.stringify(credentials)) : null,
      credentialHint: remaining.length ? integration.credentialHint : null,
      status: remaining.length ? integration.status : "disconnected",
      enabled: remaining.length ? integration.enabled : false,
      updatedAt: new Date(),
    }).where(eq(integrations.id, integration.id)).returning();
    await audit(user, "integration.account_removed", "integration", integration.id, { provider: key, accountId, remaining: remaining.length });
    return Response.json({ integration: publicIntegration(updated), guidance: `${originals.find((entry) => entry.id === accountId)?.label || accountId} was removed. Revoke its token at the provider to complete revocation.` });
  }

  try {
    const result = await runIntegration(integration, parsed.data.action);
    await audit(user, parsed.data.action === "test" ? "integration.test_succeeded" : "integration.sync_succeeded", "integration", integration.id, { provider: key, records: result.count });
    const updated = await find(user.workspaceId, key);
    return Response.json({ ok: true, result, integration: updated ? publicIntegration(updated) : null });
  } catch (error) {
    await audit(user, parsed.data.action === "test" ? "integration.test_failed" : "integration.sync_failed", "integration", integration.id, { provider: key, error: error instanceof Error ? error.message.slice(0, 500) : "Unknown provider error" });
    const updated = await find(user.workspaceId, key);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Provider request failed.", integration: updated ? publicIntegration(updated) : null }, { status: 400 });
  }
}
