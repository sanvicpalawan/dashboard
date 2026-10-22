import { db } from "@/db";
import { uploads } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/security";

export const dynamic = "force-dynamic";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 3 * 1024 * 1024;

export async function POST(request: Request) {
  const { user, response } = await apiUser();
  if (response) return response;
  if (!checkRateLimit(`upload:${user.id}`, 40, 60_000).allowed) return Response.json({ error: "Upload rate limit reached." }, { status: 429 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach an image file." }, { status: 400 });
  if (!ALLOWED.has(file.type)) return Response.json({ error: "Only JPEG, PNG, WebP and GIF images are accepted." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "Images must be 3 MB or smaller." }, { status: 400 });
  const buffer = Buffer.from(await file.arrayBuffer());
  const [record] = await db.insert(uploads).values({ workspaceId: user.workspaceId, userId: user.id, filename: file.name.slice(0, 200) || "image", mimeType: file.type, size: buffer.length, data: buffer.toString("base64") }).returning({ id: uploads.id, filename: uploads.filename });
  return Response.json({ url: `/api/uploads/${record.id}`, name: record.filename }, { status: 201 });
}
