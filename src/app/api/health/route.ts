export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ ok: true, service: "palawan-collective-command-center", version: "1.0.0", database: "not-checked", timestamp: new Date().toISOString() });
}
