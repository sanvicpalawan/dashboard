import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { apiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, response } = await apiUser();
  if (response) return response;
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [record] = await db.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.workspaceId, user.workspaceId))).limit(1);
  if (!record) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(record.data, "base64"), { headers: { "Content-Type": record.mimeType, "Content-Length": String(record.size), "Cache-Control": "private, max-age=86400", "Content-Disposition": `inline; filename="${record.filename.replace(/[^\w.-]/g, "_")}"`, "X-Content-Type-Options": "nosniff" } });
}
