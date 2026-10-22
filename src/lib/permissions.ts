export const PERMISSION_GROUPS = {
  Administration: ["admin.access", "users.manage", "roles.manage", "settings.manage", "audit.view", "security.manage"],
  Dashboards: ["dashboards.view", "dashboards.manage", "dashboards.publish", "customize.own"],
  Agency: ["clients.view", "clients.manage", "projects.view", "projects.manage", "tasks.view", "tasks.manage", "websites.view", "websites.manage", "services.view", "services.manage", "operations.view", "operations.manage"],
  Finance: ["finance.view", "finance.manage"],
  "Lead generation": ["leads.view", "leads.manage"],
  "Automation tools": ["tools.view", "tools.manage"],
  "Agent execution": ["agent.view", "agent.run", "agent.manage"],
  Integrations: ["integrations.view", "integrations.manage", "credentials.manage", "deployments.manage"],
  Appearance: ["appearance.view", "appearance.manage"],
} as const;

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

const agencyRead = ["dashboards.view", "customize.own", "clients.view", "projects.view", "tasks.view", "websites.view", "services.view", "operations.view", "leads.view", "tools.view"];
const agencyWrite = ["clients.manage", "projects.manage", "tasks.manage", "websites.manage", "services.manage", "operations.manage", "leads.manage", "tools.manage"];

export const DEFAULT_ROLES = [
  { name: "Super Administrator", slug: "super-admin", description: "Unrestricted workspace, security, credential and financial control.", permissions: ["*"] },
  { name: "Administrator", slug: "administrator", description: "Controls dashboards, users, integrations and workspace configuration.", permissions: ["admin.access", "users.manage", "roles.manage", "settings.manage", "audit.view", "security.manage", "dashboards.view", "dashboards.manage", "dashboards.publish", "customize.own", "integrations.view", "integrations.manage", "credentials.manage", "deployments.manage", "agent.view", "agent.run", "agent.manage", "appearance.view", "appearance.manage", "finance.view", ...agencyRead, ...agencyWrite] },
  { name: "Agency Manager", slug: "agency-manager", description: "Runs client delivery, projects, services and team operations.", permissions: ["admin.access", "dashboards.view", "dashboards.manage", "dashboards.publish", "customize.own", "appearance.view", "integrations.view", "agent.view", "agent.run", "agent.manage", "finance.view", ...agencyRead, ...agencyWrite] },
  { name: "Developer", slug: "developer", description: "Delivery-focused access to projects, websites and read-only development integrations.", permissions: [...agencyRead, "projects.manage", "tasks.manage", "websites.manage", "tools.manage", "integrations.view", "agent.view", "agent.run", "agent.manage", "appearance.view"] },
  { name: "Automation Operator", slug: "automation-operator", description: "Monitors approved workflows and retries authorized operational jobs.", permissions: ["dashboards.view", "customize.own", "projects.view", "tasks.view", "operations.view", "operations.manage", "tools.view", "tools.manage", "integrations.view", "agent.view", "agent.run", "agent.manage", "appearance.view"] },
  { name: "Finance Manager", slug: "finance-manager", description: "Manages invoices, subscriptions, expenses and commercial reporting.", permissions: ["dashboards.view", "customize.own", "clients.view", "projects.view", "services.view", "services.manage", "finance.view", "finance.manage", "appearance.view"] },
  { name: "Client Manager", slug: "client-manager", description: "Owns client relationships, project coordination and renewals.", permissions: [...agencyRead, "clients.manage", "projects.manage", "tasks.manage", "websites.manage", "leads.manage", "finance.view", "appearance.view"] },
  { name: "Read-only Team Member", slug: "read-only", description: "Read-only agency context with personal theme customization.", permissions: [...agencyRead, "appearance.view"] },
  { name: "Client Viewer", slug: "client-viewer", description: "Reserved for a future, separately scoped client portal; no default admin access.", permissions: ["dashboards.view"] },
] as const;

export type SessionUser = {
  id: string;
  workspaceId: string;
  teamId: string | null;
  roleId: string;
  roleSlug: string;
  roleName: string;
  name: string;
  email: string;
  title: string;
  permissions: string[];
  workspaceName: string;
  workspaceSlug: string;
  demoMode: boolean;
  sessionId: string;
};

export function hasPermission(user: Pick<SessionUser, "permissions"> | null, permission: string) {
  if (!user) return false;
  if (user.permissions.includes("*") || user.permissions.includes(permission)) return true;
  return user.permissions.some((granted) => granted.endsWith(".*") && permission.startsWith(granted.slice(0, -1)));
}

export function can(user: SessionUser | null, ...permissions: string[]) {
  return permissions.every((permission) => hasPermission(user, permission));
}
