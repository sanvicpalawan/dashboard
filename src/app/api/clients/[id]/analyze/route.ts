import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, agentJobs } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ANALYZE_PROMPT = (website: string, name: string) => `You are the Lead Strategist at a digital marketing agency.
TASK: Use browseros-neo to navigate to ${website}. Read the homepage and services.
OUTPUT FORMAT: Respond with a strict JSON object (do not include markdown formatting like \`\`\`json, just raw text). Use exactly this structure:
{
"business_name": "String",
"core_offer": "1 sentence summary",
"target_audience": "1 sentence summary",
"brand_voice": ["Adjective 1", "Adjective 2", "Adjective 3"],
"content_pillars": ["Pillar 1", "Pillar 2", "Pillar 3"],
"landing_page_angle": "A headline and subheadline"
}

Instructions:

If the client has no website, use their business name as the search term. The client's business name is "${name}".`;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("clients.manage");
  if (response) return response;
  const { id } = await params;

  const [client] = await db.select().from(clients).where(and(eq(clients.id, id), eq(clients.workspaceId, user.workspaceId))).limit(1);
  if (!client) return Response.json({ error: "Client not found." }, { status: 404 });

  const links = Array.isArray(client.links) ? client.links : [];
  const websiteUrl = links.find((l: any) => typeof l?.url === "string" && l.url.trim())?.url?.trim() || client.name;
  const instructions = ANALYZE_PROMPT(websiteUrl, client.name);

  const [job] = await db.insert(agentJobs).values({
    workspaceId: user.workspaceId,
    createdBy: user.id,
    createdByName: user.name,
    clientId: client.id,
    title: `Analyze brand: ${client.name}`,
    instructions,
    directory: "C:\\dev\\harness-smoke",
    agent: "marketing",
    model: null,
    status: "queued",
    approval: "auto",
    priority: 5,
    maxAttempts: 2,
  }).returning();

  await audit(user, "client.brand.analyze", "client", client.id, { jobId: job.id });
  return Response.json({ job: { id: job.id, status: job.status } }, { status: 201 });
}
