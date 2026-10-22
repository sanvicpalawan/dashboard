import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { toolFiles, tools } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkRateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";
const MAX_BYTES = 25 * 1024 * 1024;
const BLOCKED = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|jar|apk|dmg|pkg)$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser("tools.manage");
  if (response) return response;
  const id = (await params).id;
  if (!checkRateLimit(`tool-upload:${user.id}`, 20, 60_000).allowed) return Response.json({ error: "Upload rate limit reached." }, { status: 429 });
  const [tool] = await db.select().from(tools).where(and(eq(tools.id, id), eq(tools.workspaceId, user.workspaceId))).limit(1);
  if (!tool) return Response.json({ error: "Tool not found." }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((item): item is File => item instanceof File);
  if (!files.length) return Response.json({ error: "Attach at least one code file or archive." }, { status: 400 });
  const description = String(form?.get("description") ?? "").slice(0, 300);
  const version = String(form?.get("version") ?? tool.version).slice(0, 40);
  const saved = [];
  for (const file of files.slice(0, 10)) {
    if (file.size > MAX_BYTES) return Response.json({ error: `${file.name} exceeds the 25 MB limit.` }, { status: 400 });
    if (BLOCKED.test(file.name)) return Response.json({ error: `${file.name}: executable installers are not accepted. Upload source archives (.zip, .tar.gz) or code files.` }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const [record] = await db.insert(toolFiles).values({ toolId: id, uploadedBy: user.id, filename: file.name.slice(0, 200) || "file", mimeType: file.type || "application/octet-stream", size: buffer.length, data: buffer.toString("base64"), description, version }).returning({ id: toolFiles.id, filename: toolFiles.filename, size: toolFiles.size, mimeType: toolFiles.mimeType, description: toolFiles.description, version: toolFiles.version, createdAt: toolFiles.createdAt });
    saved.push({ ...record, author: user.name });
  }
  await audit(user, "tool.files_uploaded", "tool", id, { count: saved.length, filenames: saved.map((file) => file.filename) });
  return Response.json({ files: saved }, { status: 201 });
}
