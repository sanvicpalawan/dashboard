import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  legalName: text("legal_name"),
  brandMark: text("brand_mark").notNull().default("PC"),
  demoMode: boolean("demo_mode").notNull().default(false),
  settings: jsonb("settings").notNull().default({}),
  ...timestamps,
});

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  isSystem: boolean("is_system").notNull().default(true),
  ...timestamps,
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("#8b9cf9"),
  ...timestamps,
}, (table) => [uniqueIndex("teams_workspace_slug_idx").on(table.workspaceId, table.slug)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("active"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  ...timestamps,
}, (table) => [index("users_workspace_idx").on(table.workspaceId)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent").notNull().default(""),
  ipAddress: text("ip_address").notNull().default(""),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("sessions_user_idx").on(table.userId), index("sessions_expiry_idx").on(table.expiresAt)]);

export const themes = pgTable("themes", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull().default(""),
  mode: text("mode").notNull().default("dark"),
  colors: jsonb("colors").$type<Record<string, string>>().notNull(),
  typography: text("typography").notNull().default("inter"),
  density: text("density").notNull().default("comfortable"),
  cardStyle: text("card_style").notNull().default("bordered"),
  sidebarStyle: text("sidebar_style").notNull().default("solid"),
  isDefault: boolean("is_default").notNull().default(false),
  builtIn: boolean("built_in").notNull().default(true),
  ...timestamps,
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  themeId: uuid("theme_id").references(() => themes.id, { onDelete: "set null" }),
  accent: text("accent"),
  density: text("density"),
  mode: text("mode"),
  defaultDashboardId: uuid("default_dashboard_id"),
  navigation: jsonb("navigation").$type<string[]>().notNull().default([]),
  notificationSettings: jsonb("notification_settings").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description").notNull().default(""),
  audience: text("audience").notNull().default("agency"),
  status: text("status").notNull().default("draft"),
  isDefault: boolean("is_default").notNull().default(false),
  allowCustomization: boolean("allow_customization").notNull().default(true),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("dashboard_workspace_slug_idx").on(table.workspaceId, table.slug), index("dashboard_workspace_idx").on(table.workspaceId)]);

export const userDashboardLayouts = pgTable("user_dashboard_layouts", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  layout: jsonb("layout").notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("user_dashboard_layout_idx").on(table.userId, table.dashboardId)]);

export const dashboardVersions = pgTable("dashboard_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("dashboard_version_idx").on(table.dashboardId, table.version)]);

export const dashboardAssignments = pgTable("dashboard_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  canEdit: boolean("can_edit").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("dashboard_assignment_idx").on(table.dashboardId, table.subjectType, table.subjectId)]);

export const widgetDefinitions = pgTable("widget_definitions", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  version: text("version").notNull().default("1.0.0"),
  dataContract: text("data_contract").notNull(),
  defaultWidth: integer("default_width").notNull().default(4),
  defaultHeight: integer("default_height").notNull().default(3),
  minWidth: integer("min_width").notNull().default(3),
  minHeight: integer("min_height").notNull().default(2),
  maxWidth: integer("max_width").notNull().default(12),
  maxHeight: integer("max_height").notNull().default(6),
  refreshInterval: integer("refresh_interval").notNull().default(300),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  allowedRoles: jsonb("allowed_roles").$type<string[]>().notNull().default([]),
  settingsSchema: jsonb("settings_schema").notNull().default({}),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
  installed: boolean("installed").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  defaults: jsonb("defaults").notNull().default({}),
  ...timestamps,
});

export const widgetInstances = pgTable("widget_instances", {
  id: uuid("id").primaryKey().defaultRandom(),
  dashboardId: uuid("dashboard_id").notNull().references(() => dashboards.id, { onDelete: "cascade" }),
  definitionKey: text("definition_key").notNull().references(() => widgetDefinitions.key, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  x: integer("x").notNull().default(0),
  y: integer("y").notNull().default(0),
  width: integer("width").notNull().default(4),
  height: integer("height").notNull().default(3),
  position: integer("position").notNull().default(0),
  refreshInterval: integer("refresh_interval").notNull().default(300),
  visible: boolean("visible").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  userConfigurable: boolean("user_configurable").notNull().default(true),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
}, (table) => [index("widget_dashboard_idx").on(table.dashboardId)]);

export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("disconnected"),
  enabled: boolean("enabled").notNull().default(false),
  authMethod: text("auth_method").notNull(),
  baseUrl: text("base_url"),
  docsUrl: text("docs_url").notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  credentialEncrypted: text("credential_encrypted"),
  credentialHint: text("credential_hint"),
  allowedRoles: jsonb("allowed_roles").$type<string[]>().notNull().default([]),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [uniqueIndex("integration_workspace_key_idx").on(table.workspaceId, table.key)]);

export const integrationCache = pgTable("integration_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  resourceKey: text("resource_key").notNull(),
  payload: jsonb("payload").notNull(),
  sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("integration_resource_idx").on(table.integrationId, table.resourceKey)]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  triggerType: text("trigger_type").notNull().default("manual"),
  recordsSynced: integer("records_synced").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  industry: text("industry").notNull().default(""),
  location: text("location").notNull().default(""),
  status: text("status").notNull().default("active"),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  servicePlan: text("service_plan").notNull().default(""),
  health: text("health").notNull().default("good"),
  notes: text("notes").notNull().default(""),
  links: jsonb("links").$type<{ label: string; url: string }[]>().notNull().default([]),
  ...timestamps,
}, (table) => [index("clients_workspace_idx").on(table.workspaceId)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("active"),
  priority: text("priority").notNull().default("medium"),
  progress: integer("progress").notNull().default(0),
  startDate: date("start_date"),
  dueDate: date("due_date"),
  deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
  repositoryUrl: text("repository_url"),
  budgetMinor: integer("budget_minor").notNull().default(0),
  currency: text("currency").notNull().default("PHP"),
  ...timestamps,
}, (table) => [uniqueIndex("project_workspace_code_idx").on(table.workspaceId, table.code), index("project_client_idx").on(table.clientId)]);

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  dueDate: date("due_date"),
  estimateHours: numeric("estimate_hours", { precision: 6, scale: 2 }).notNull().default("0"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  ...timestamps,
}, (table) => [index("tasks_project_idx").on(table.projectId), index("tasks_due_idx").on(table.dueDate)]);

export const projectLinks = pgTable("project_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull().default("other"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("project_links_project_idx").on(table.projectId)]);

export const projectMedia = pgTable("project_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull().default("image"),
  url: text("url").notNull(),
  caption: text("caption").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("project_media_project_idx").on(table.projectId)]);

export const projectComments = pgTable("project_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  attachments: jsonb("attachments").$type<{ url: string; name: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("project_comments_project_idx").on(table.projectId)]);

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const prospects = pgTable("prospects", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  businessName: text("business_name").notNull(),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  whatsapp: text("whatsapp").notNull().default(""),
  website: text("website").notNull().default(""),
  socialLinks: text("social_links").notNull().default(""),
  industry: text("industry").notNull().default(""),
  location: text("location").notNull().default(""),
  source: text("source").notNull().default(""),
  stage: text("stage").notNull().default("new"),
  // How much of this record is confirmed: unverified (imported/assumed), partial, verified (checked against the business).
  verification: text("verification").notNull().default("unverified"),
  pitchedServices: jsonb("pitched_services").$type<string[]>().notNull().default([]),
  estimatedValueMinor: integer("estimated_value_minor").notNull().default(0),
  notes: text("notes").notNull().default(""),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  nextFollowUpAt: date("next_follow_up_at"),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  declinedReason: text("declined_reason").notNull().default(""),
  ...timestamps,
}, (table) => [index("prospects_workspace_idx").on(table.workspaceId), index("prospects_stage_idx").on(table.stage)]);

export const prospectActivities = pgTable("prospect_activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  prospectId: uuid("prospect_id").notNull().references(() => prospects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  channel: text("channel").notNull().default("email"),
  type: text("type").notNull().default("outreach"),
  pitched: jsonb("pitched").$type<string[]>().notNull().default([]),
  outcome: text("outcome").notNull().default("pending"),
  response: text("response").notNull().default(""),
  note: text("note").notNull().default(""),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("prospect_activities_prospect_idx").on(table.prospectId)]);

export const websites = pgTable("websites", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  productionUrl: text("production_url").notNull(),
  previewUrl: text("preview_url"),
  repositoryUrl: text("repository_url"),
  hostingProvider: text("hosting_provider").notNull().default(""),
  status: text("status").notNull().default("unknown"),
  sslExpiry: date("ssl_expiry"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, (table) => [uniqueIndex("website_domain_idx").on(table.workspaceId, table.domain)]);

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  setupFeeMinor: integer("setup_fee_minor").notNull().default(0),
  recurringFeeMinor: integer("recurring_fee_minor").notNull().default(0),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  thirdPartyCostMinor: integer("third_party_cost_minor").notNull().default(0),
  internalCostMinor: integer("internal_cost_minor").notNull().default(0),
  currency: text("currency").notNull().default("PHP"),
  pricingNotes: text("pricing_notes").notNull().default(""),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  invoiceNumber: text("invoice_number").notNull(),
  status: text("status").notNull().default("draft"),
  issueDate: date("issue_date").notNull(),
  dueDate: date("due_date").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  currency: text("currency").notNull().default("PHP"),
  subtotalMinor: integer("subtotal_minor").notNull().default(0),
  taxMinor: integer("tax_minor").notNull().default(0),
  totalMinor: integer("total_minor").notNull().default(0),
  amountPaidMinor: integer("amount_paid_minor").notNull().default(0),
  source: text("source").notNull().default("manual"),
  externalRef: text("external_ref"),
  ...timestamps,
}, (table) => [uniqueIndex("invoice_number_idx").on(table.workspaceId, table.invoiceNumber), index("invoice_status_idx").on(table.status)]);

/**
 * One priced line on a proposal.
 *
 * The catalogue row is snapshotted at the moment the line is added (name, description and
 * unit price are copied, not referenced) so a later price change in `services` cannot
 * silently rewrite a proposal a client already received. `serviceId` is kept only to trace
 * the line back to the catalogue. Amounts are integer minor units (centavos).
 */
export type ProposalLineItem = {
  serviceId: string | null;
  name: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
};

/**
 * Commercial proposal — the link between the priced service catalogue and a signed engagement.
 *
 * Created and edited on the internal dashboard, shared with the client through `publicToken`,
 * and on acceptance creates the project and the draft invoice in one transaction
 * (`POST /api/proposals/[id]/accept`). `projectId`/`invoiceId` are what make that acceptance
 * idempotent and traceable: re-opening an accepted link returns the same records instead of
 * duplicating them.
 *
 * status: draft | sent | accepted | declined
 */
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"),
  lineItems: jsonb("line_items").$type<ProposalLineItem[]>().notNull().default([]),
  totalMinor: integer("total_minor").notNull().default(0),
  currency: text("currency").notNull().default("PHP"),
  publicToken: uuid("public_token").notNull().defaultRandom(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  signatureName: text("signature_name").notNull().default(""),
  ipAddress: text("ip_address").notNull().default(""),
  ...timestamps,
}, (table) => [
  uniqueIndex("proposal_public_token_idx").on(table.publicToken),
  index("proposal_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("proposal_client_idx").on(table.clientId),
]);

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  amountMinor: integer("amount_minor").notNull().default(0),
  currency: text("currency").notNull().default("PHP"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  renewalDate: date("renewal_date"),
  ...timestamps,
});

export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  vendor: text("vendor").notNull().default(""),
  description: text("description").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: text("currency").notNull().default("PHP"),
  billingCycle: text("billing_cycle").notNull().default("one-time"),
  paymentMethod: text("payment_method").notNull().default(""),
  status: text("status").notNull().default("paid"),
  incurredAt: date("incurred_at").notNull(),
  nextRenewalAt: date("next_renewal_at"),
  receiptUrl: text("receipt_url"),
  notes: text("notes").notNull().default(""),
  ...timestamps,
}, (table) => [index("expenses_workspace_date_idx").on(table.workspaceId, table.incurredAt)]);

export const tools = pgTable("tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  builtById: uuid("built_by_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("Automation"),
  status: text("status").notNull().default("active"),
  visibility: text("visibility").notNull().default("internal"),
  repositoryUrl: text("repository_url"),
  vercelUrl: text("vercel_url"),
  liveUrl: text("live_url"),
  builtByName: text("built_by_name").notNull().default(""),
  contributors: jsonb("contributors").$type<string[]>().notNull().default([]),
  language: text("language").notNull().default(""),
  languages: jsonb("languages").$type<{ name: string; percent: number }[]>().notNull().default([]),
  techStack: jsonb("tech_stack").$type<string[]>().notNull().default([]),
  ui: text("ui").notNull().default(""),
  database: text("database").notNull().default(""),
  messaging: text("messaging").notNull().default(""),
  deployment: text("deployment").notNull().default(""),
  codeTree: text("code_tree").notNull().default(""),
  readme: text("readme").notNull().default(""),
  priceModel: text("price_model").notNull().default("internal"),
  priceMinor: integer("price_minor").notNull().default(0),
  recurringPriceMinor: integer("recurring_price_minor").notNull().default(0),
  currency: text("currency").notNull().default("PHP"),
  license: text("license").notNull().default("Proprietary"),
  version: text("version").notNull().default("1.0.0"),
  topics: jsonb("topics").$type<string[]>().notNull().default([]),
  stars: integer("stars").notNull().default(0),
  ...timestamps,
}, (table) => [uniqueIndex("tools_workspace_slug_idx").on(table.workspaceId, table.slug)]);

export const toolLinks = pgTable("tool_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  kind: text("kind").notNull().default("other"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const toolMedia = pgTable("tool_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  type: text("type").notNull().default("image"),
  url: text("url").notNull(),
  caption: text("caption").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const toolFiles = pgTable("tool_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  data: text("data").notNull(),
  description: text("description").notNull().default(""),
  version: text("version").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const toolComments = pgTable("tool_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolId: uuid("tool_id").notNull().references(() => tools.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  attachments: jsonb("attachments").$type<{ url: string; name: string }[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  websiteId: uuid("website_id").references(() => websites.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  ...timestamps,
});

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  source: text("source").notNull(),
  status: text("status").notNull(),
  externalId: text("external_id"),
  detail: text("detail").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  ...timestamps,
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  type: text("type").notNull().default("info"),
  link: text("link"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  metadata: jsonb("metadata").notNull().default({}),
  ipAddress: text("ip_address").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("audit_workspace_created_idx").on(table.workspaceId, table.createdAt)]);

export const backgroundJobs = pgTable("background_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  payload: jsonb("payload").notNull().default({}),
  error: text("error"),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Agent execution queue.
 *
 * A job is a durable instruction for the local OpenCode worker. The worker claims
 * one queued job at a time with FOR UPDATE SKIP LOCKED, runs `opencode run` in the
 * job directory, and records progress in `output`/`result`/`error`.
 *
 * status: queued | awaiting_approval | running | succeeded | failed | cancelled
 * approval: auto | required  (required jobs never start until approved)
 */
export const agentJobs = pgTable("agent_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdByName: text("created_by_name").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  directory: text("directory").notNull(),
  agent: text("agent").notNull().default("build"),
  model: text("model"),
  status: text("status").notNull().default("queued"),
  approval: text("approval").notNull().default("auto"),
  approvalReason: text("approval_reason"),
  priority: integer("priority").notNull().default(5),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(2),
  sessionId: text("session_id"),
  result: text("result").notNull().default(""),
  output: text("output").notNull().default(""),
  error: text("error"),
  exitCode: integer("exit_code"),
  worker: text("worker"),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  repeatMinutes: integer("repeat_minutes"),
  scheduleKey: text("schedule_key"),
  ...timestamps,
}, (table) => [
  index("agent_jobs_queue_idx").on(table.status, table.priority, table.runAt),
  index("agent_jobs_workspace_idx").on(table.workspaceId, table.createdAt),
]);

export const webhookEvents = pgTable("webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  externalId: text("external_id"),
  status: text("status").notNull().default("received"),
  payloadSummary: jsonb("payload_summary").notNull().default({}),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRecord = typeof users.$inferSelect;
export type DashboardRecord = typeof dashboards.$inferSelect;
export type WidgetInstanceRecord = typeof widgetInstances.$inferSelect;
export type IntegrationRecord = typeof integrations.$inferSelect;
export type AgentJobRecord = typeof agentJobs.$inferSelect;
export type ProposalRecord = typeof proposals.$inferSelect;
