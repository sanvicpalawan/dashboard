import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, service: "palawan-collective-command-center", version: "1.0.0", database: "connected", latencyMs: Date.now() - started, timestamp: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false, service: "palawan-collective-command-center", database: "unavailable", timestamp: new Date().toISOString() }, { status: 500 });
  }
}
