import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/permissions";
import { checkRateLimit, encryptSecret, secretHint } from "@/lib/security";
import { publicIntegration, runIntegration } from "@/lib/integration-service";

export const dynamic = "force-dynamic";
const patchSchema = z.object({ baseUrl: z.string().max(500).nullable().optional(), secret: z.string().max(4000).optional(), enabled: z.boolean().optional(), allowedRoles: z.array(z.string().max(100)).max(30).optional(), config: z.record(z.string(), z.unknown()).optional() });
const actionSchema = z.object({ action: z.enum(["test", "sync", "disconnect"]), confirmation: z.string().optional() });

async function find(workspaceId: string, key: string) {
  return (await db.select().from(integrations).where(and(eq(integrations.workspaceId, workspaceId), eq(integrations.key, key))).limit(1))[0];
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
  const [updated] = await db.update(integrations).set({
    baseUrl: parsed.data.baseUrl === undefined ? integration.baseUrl : parsed.data.baseUrl?.replace(/\/$/, "") || null,
    enabled: parsed.data.enabled ?? integration.enabled,
    allowedRoles: parsed.data.allowedRoles ?? integration.allowedRoles,
    config: parsed.data.config ? { ...integration.config, ...parsed.data.config } : integration.config,
    credentialEncrypted: secret ? encryptSecret(secret) : integration.credentialEncrypted,
    credentialHint: secret ? secretHint(secret) : integration.credentialHint,
    status: secret || parsed.data.baseUrl !== undefined ? "disconnected" : integration.status,
    lastError: secret || parsed.data.baseUrl !== undefined ? null : integration.lastError,
    updatedAt: new Date(),
  }).where(eq(integrations.id, integration.id)).returning();
  await audit(user, secret ? "integration.credentials_updated" : "integration.configuration_updated", "integration", integration.id, { provider: key, baseUrlChanged: parsed.data.baseUrl !== undefined, enabled: updated.enabled, allowedRoles: updated.allowedRoles });
  return Response.json({ integration: publicIntegration(updated) });
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
    const [updated] = await db.update(integrations).set({ credentialEncrypted: null, credentialHint: null, enabled: false, status: "disconnected", lastError: null, updatedAt: new Date() }).where(eq(integrations.id, integration.id)).returning();
    await audit(user, "integration.disconnected", "integration", integration.id, { provider: key, guidance: "Revoke the credential at the provider; local removal does not revoke it remotely." });
    return Response.json({ integration: publicIntegration(updated), guidance: "Local credentials were removed. Revoke the original token in the provider console to complete revocation." });
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
