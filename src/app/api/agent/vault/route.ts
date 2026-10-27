import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { decryptSecret } from "@/lib/security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expectedAuth = `Bearer ${process.env.AGENT_VAULT_SECRET}`;
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== expectedAuth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) {
    return Response.json({ error: "Missing 'key' parameter" }, { status: 400 });
  }

  const [integration] = await db
    .select()
    .from(integrations)
    .where(eq(integrations.key, key))
    .limit(1);

  if (!integration) {
    return Response.json({ error: "Integration not found" }, { status: 404 });
  }

  let token: string | null = null;
  if (integration.credentialEncrypted) {
    try {
      token = decryptSecret(integration.credentialEncrypted);
    } catch {
      return Response.json({ error: "Credential decryption failed" }, { status: 500 });
    }
  }

  if (!token) {
    return Response.json({ error: "No credential stored" }, { status: 404 });
  }

  return Response.json({ key, token });
}