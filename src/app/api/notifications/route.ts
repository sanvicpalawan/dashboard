import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { apiUser } from "@/lib/auth";

export async function PATCH(request: Request) {
  const { user, response } = await apiUser();
  if (response) return response;
  const parsed = z.object({ id: z.string().uuid().optional() }).safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Invalid notification." }, { status: 400 });
  await db.update(notifications).set({ readAt: new Date() }).where(parsed.data.id ? and(eq(notifications.id, parsed.data.id), eq(notifications.userId, user.id)) : and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
  return Response.json({ ok: true });
}
