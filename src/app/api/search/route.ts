import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { clients, projects, websites } from "@/db/schema";
import { apiUser } from "@/lib/auth";
import { listAccessibleDashboards } from "@/lib/dashboards";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { user, response } = await apiUser();
  if (response) return response;
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "";
  const staticResults = [
    { id: "overview", type: "Go to", title: "Agency overview", subtitle: "Command dashboard", url: "/" },
    { id: "appearance", type: "Go to", title: "Appearance", subtitle: "Themes and personal preferences", url: "/appearance" },
    ...(hasPermission(user, "admin.access") ? [{ id: "admin", type: "Go to", title: "Administration", subtitle: "Workspace control plane", url: "/admin" }, { id: "integrations", type: "Go to", title: "Integrations", subtitle: "Connections and synchronization", url: "/admin/integrations" }] : []),
  ];
  if (!query) return Response.json({ results: staticResults });
  const like = `%${query.replaceAll("%", "")}%`;
  const [clientRows, projectRows, websiteRows, dashboardRows] = await Promise.all([
    hasPermission(user, "clients.view") ? db.select().from(clients).where(and(eq(clients.workspaceId, user.workspaceId), or(ilike(clients.name, like), ilike(clients.industry, like)))).limit(6) : [],
    hasPermission(user, "projects.view") ? db.select().from(projects).where(and(eq(projects.workspaceId, user.workspaceId), or(ilike(projects.name, like), ilike(projects.code, like)))).limit(6) : [],
    hasPermission(user, "websites.view") ? db.select().from(websites).where(and(eq(websites.workspaceId, user.workspaceId), or(ilike(websites.name, like), ilike(websites.domain, like)))).limit(6) : [],
    listAccessibleDashboards(user),
  ]);
  const results = [
    ...staticResults.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())),
    ...dashboardRows.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())).map((item) => ({ id: item.id, type: "Dashboard", title: item.name, subtitle: item.status, url: `/?dashboard=${item.id}` })),
    ...clientRows.map((item) => ({ id: item.id, type: "Client", title: item.name, subtitle: `${item.industry} · ${item.location}`, url: `/clients?selected=${item.id}` })),
    ...projectRows.map((item) => ({ id: item.id, type: "Project", title: item.name, subtitle: `${item.code} · ${item.status}`, url: `/projects?selected=${item.id}` })),
    ...websiteRows.map((item) => ({ id: item.id, type: "Website", title: item.name, subtitle: item.domain, url: `/websites?selected=${item.id}` })),
  ];
  return Response.json({ results: results.slice(0, 20) });
}
