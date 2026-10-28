import { eq } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/db/schema";
import { decryptSecret } from "@/lib/security";
import { validateAgentOrVaultToken } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Machine credential only — never a browser session. AGENT_API_KEY, or the
  // legacy AGENT_VAULT_SECRET that scripts/get-token.sh still sends.
  if (!validateAgentOrVaultToken(request)) {
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