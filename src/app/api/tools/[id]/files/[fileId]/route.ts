import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { toolFiles, tools } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const { user, response } = await apiUser("tools.view");
  if (response) return response;
  const { id, fileId } = await params;
  const [row] = await db.select({ file: toolFiles }).from(toolFiles).innerJoin(tools, eq(tools.id, toolFiles.toolId)).where(and(eq(toolFiles.id, fileId), eq(toolFiles.toolId, id), eq(tools.workspaceId, user.workspaceId))).limit(1);
  if (!row) return new Response("Not found", { status: 404 });
  await audit(user, "tool.file_downloaded", "tool", id, { filename: row.file.filename });
  const safeName = row.file.filename.replace(/[^\w.() -]/g, "_");
  return new Response(Buffer.from(row.file.data, "base64"), { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(row.file.size), "Content-Disposition": `attachment; filename="${safeName}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
}
