import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations, webhookEvents } from "@/db/schema";
import { checkRateLimit } from "@/lib/security";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "local";
  if (!checkRateLimit(`webhook:${ip}`, 120, 60_000).allowed) return Response.json({ error: "Rate limit exceeded." }, { status: 429 });
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "GitHub webhooks are not configured. Set GITHUB_WEBHOOK_SECRET on the server." }, { status: 503 });
  const workspaceId = new URL(request.url).searchParams.get("workspace");
  if (!workspaceId) return Response.json({ error: "workspace query parameter is required." }, { status: 400 });
  const [integration] = await db.select().from(integrations).where(eq(integrations.workspaceId, workspaceId)).limit(1);
  if (!integration) return Response.json({ error: "Workspace integration not found." }, { status: 404 });
  const body = await request.text();
  if (body.length > 1_000_000) return Response.json({ error: "Payload too large." }, { status: 413 });
  const signature = request.headers.get("x-hub-signature-256") || "";
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const valid = signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  let payload: Record<string, any>;
  try { payload = JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON." }, { status: 400 }); }
  const eventType = request.headers.get("x-github-event") || "unknown";
  const delivery = request.headers.get("x-github-delivery");
  await db.insert(webhookEvents).values({ workspaceId, provider: "github", eventType, externalId: delivery, status: "received", payloadSummary: { action: typeof payload.action === "string" ? payload.action.slice(0, 80) : undefined, repository: typeof payload.repository?.full_name === "string" ? payload.repository.full_name.slice(0, 200) : undefined, ref: typeof payload.ref === "string" ? payload.ref.slice(0, 200) : undefined, sender: typeof payload.sender?.login === "string" ? payload.sender.login.slice(0, 100) : undefined } });
  return Response.json({ ok: true, delivery });
}
