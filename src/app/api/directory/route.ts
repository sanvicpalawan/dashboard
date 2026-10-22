import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { teams, users } from "@/db/schema";
import { apiUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function GET() {
  const { user, response } = await apiUser();
  if (response) return response;
  const [userRows, teamRows] = await Promise.all([
    db.select({ id: users.id, name: users.name, title: users.title, teamId: users.teamId }).from(users).where(and(eq(users.workspaceId, user.workspaceId), eq(users.status, "active"))).orderBy(users.name),
    db.select({ id: teams.id, name: teams.name, color: teams.color }).from(teams).where(eq(teams.workspaceId, user.workspaceId)).orderBy(teams.name),
  ]);
  return Response.json({ users: userRows, teams: teamRows });
}
