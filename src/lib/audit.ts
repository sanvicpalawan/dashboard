import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import type { SessionUser } from "@/lib/permissions";

const SENSITIVE_KEY = /pass(word)?|token|secret|credential|authorization|api[-_]?key|cookie/i;

function clean(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => clean(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .slice(0, 50)
      .map(([key, item]) => [key, clean(item, depth + 1)]));
  }
  if (typeof value === "string") return value.slice(0, 1000);
  return value;
}

export async function audit(user: SessionUser | null, action: string, entityType: string, entityId?: string | null, metadata: Record<string, unknown> = {}, workspaceId?: string) {
  const workspace = user?.workspaceId ?? workspaceId;
  if (!workspace) return;
  await db.insert(auditEvents).values({
    workspaceId: workspace,
    userId: user?.id,
    action,
    entityType,
    entityId: entityId ?? null,
    metadata: clean(metadata) as Record<string, unknown>,
  });
}
