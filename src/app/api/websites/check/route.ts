import { and, eq } from "drizzle-orm";
import tls from "node:tls";
import { z } from "zod";
import { db } from "@/db";
import { websites } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { safeExternalUrl } from "@/lib/security";

export const dynamic = "force-dynamic";

function certificateExpiry(url: URL): Promise<string | null> {
  if (url.protocol !== "https:") return Promise.resolve(null);
  return new Promise((resolve) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port || 443), servername: url.hostname, rejectUnauthorized: true, timeout: 8000 }, () => {
      const certificate = socket.getPeerCertificate();
      const expiry = certificate?.valid_to ? new Date(certificate.valid_to) : null;
      socket.end();
      resolve(expiry && !Number.isNaN(expiry.getTime()) ? expiry.toISOString().slice(0, 10) : null);
    });
    socket.once("error", () => resolve(null));
    socket.once("timeout", () => { socket.destroy(); resolve(null); });
  });
}

export async function POST(request: Request) {
  const { user, response } = await apiUser("websites.manage");
  if (response) return response;
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid website." }, { status: 400 });
  const [website] = await db.select().from(websites).where(and(eq(websites.id, parsed.data.id), eq(websites.workspaceId, user.workspaceId))).limit(1);
  if (!website) return Response.json({ error: "Website not found." }, { status: 404 });
  let status = "offline";
  let httpStatus: number | null = null;
  let detail = "";
  try {
    const url = safeExternalUrl(website.productionUrl);
    const started = Date.now();
    const result = await fetch(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000), cache: "no-store", headers: { "User-Agent": "MerQato-Uptime-Check/1.0" } });
    httpStatus = result.status;
    status = result.status < 400 ? "operational" : result.status < 500 ? "degraded" : "offline";
    detail = `HTTP ${result.status} in ${Date.now() - started} ms`;
  } catch (error) {
    detail = error instanceof Error ? error.message.slice(0, 300) : "Network request failed.";
  }
  const checkedAt = new Date();
  let sslExpiry: string | null = null;
  try { sslExpiry = await certificateExpiry(new URL(website.productionUrl)); } catch { sslExpiry = null; }
  await db.update(websites).set({ status, lastCheckedAt: checkedAt, sslExpiry: sslExpiry || website.sslExpiry, updatedAt: new Date() }).where(eq(websites.id, website.id));
  await audit(user, "website.availability_checked", "website", website.id, { status, httpStatus, detail, certificateExpiryRead: Boolean(sslExpiry) });
  return Response.json({ ok: true, reachable: status === "operational", status, httpStatus, detail, sslExpiry, checkedAt });
}
