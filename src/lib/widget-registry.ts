export type WidgetDefinitionInput = {
  key: string;
  name: string;
  category: string;
  description: string;
  dataContract: string;
  permissions: string[];
  dependencies?: string[];
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  refreshInterval?: number;
  settingsSchema?: Record<string, unknown>;
};

const w = (input: WidgetDefinitionInput) => ({
  version: "1.0.0",
  defaultWidth: 4,
  defaultHeight: 3,
  minWidth: 3,
  minHeight: 2,
  maxWidth: 12,
  maxHeight: 6,
  refreshInterval: 300,
  allowedRoles: [] as string[],
  installed: true,
  enabled: true,
  dependencies: [] as string[],
  settingsSchema: {},
  defaults: {},
  ...input,
});

export const WIDGET_REGISTRY: ReturnType<typeof w>[] = [
  w({ key: "revenue-overview", name: "Revenue overview", category: "Agency overview", description: "Invoiced revenue, cash received and outstanding balances kept as separate values.", dataContract: "metric: invoiced, received and outstanding minor units", permissions: ["finance.view"], defaultWidth: 6 }),
  w({ key: "profit-vs-expenses", name: "Profit vs expenses", category: "Agency overview", description: "Monthly cash received against recorded expenses with the resulting estimated operating result.", dataContract: "series: monthly received, expenses and net (PHP)", permissions: ["finance.view"], defaultWidth: 8, defaultHeight: 4 }),
  w({ key: "expense-breakdown", name: "Expense breakdown", category: "Finance", description: "Recorded expenses grouped by agency category — subscriptions, VPS, LLM usage, storage, office, supplies and more.", dataContract: "list: expense totals per category for the last 90 days", permissions: ["finance.view"] }),
  w({ key: "upcoming-renewals", name: "Upcoming expense renewals", category: "Finance", description: "Subscriptions and infrastructure renewing within 30 days.", dataContract: "list: expenses with nextRenewalAt inside 30 days", permissions: ["finance.view"] }),
  w({ key: "invoice-status", name: "Paid & overdue invoices", category: "Agency overview", description: "Invoice aging based on persisted issue, due and payment records.", dataContract: "list: invoice number, client, state, amount, due date", permissions: ["finance.view"] }),
  w({ key: "active-clients", name: "Active clients", category: "Agency overview", description: "Count and health distribution for active client accounts.", dataContract: "metric: active client count with health segments", permissions: ["clients.view"], defaultHeight: 2 }),
  w({ key: "active-projects", name: "Active projects", category: "Agency overview", description: "Current delivery engagements grouped by status and priority.", dataContract: "metric: active project count and status breakdown", permissions: ["projects.view"], defaultHeight: 2 }),
  w({ key: "tasks-today", name: "Tasks due today", category: "Agency overview", description: "Open tasks due on the workspace's current local date.", dataContract: "list: task, project, assignee, priority and due date", permissions: ["tasks.view"] }),
  w({ key: "upcoming-deadlines", name: "Upcoming deadlines", category: "Agency overview", description: "A chronological view of project milestones and task due dates.", dataContract: "list: dated project and task deadlines", permissions: ["projects.view"] }),
  w({ key: "website-count", name: "Website inventory", category: "Agency overview", description: "Managed website count and recorded operational states.", dataContract: "metric: website count grouped by status", permissions: ["websites.view"], defaultHeight: 2 }),
  w({ key: "deployment-health", name: "Deployment health", category: "Agency overview", description: "Cached provider deployment results with explicit source freshness.", dataContract: "list: provider deployments and health state", permissions: ["integrations.view"], dependencies: ["vercel", "coolify"] }),
  w({ key: "open-work", name: "Issues & pull requests", category: "Agency overview", description: "Open GitHub work awaiting engineering attention.", dataContract: "list: cached GitHub issues and pull requests", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "automation-failures", name: "Automation failures", category: "Agency overview", description: "Failed automation runs and synchronization jobs from recorded events.", dataContract: "list: failed runs with source, time and detail", permissions: ["operations.view"] }),
  w({ key: "recent-activity", name: "Recent activity", category: "Agency overview", description: "Append-only administrative and operational activity, excluding secret values.", dataContract: "list: audit actor, action, entity and timestamp", permissions: ["dashboards.view"] }),
  w({ key: "system-health", name: "System health", category: "Agency overview", description: "Verified database connectivity plus integration and job failure counts.", dataContract: "health: database, integration errors, queue failures", permissions: ["admin.access"], refreshInterval: 60 }),

  w({ key: "client-list", name: "Client list", category: "Clients & projects", description: "Searchable client accounts with owner, plan and relationship health.", dataContract: "table: client profile and account status", permissions: ["clients.view"], defaultWidth: 6, defaultHeight: 4 }),
  w({ key: "client-details", name: "Client details", category: "Clients & projects", description: "A selected client's contacts, service plan, notes and internal links.", dataContract: "detail: client selected by settings.clientId", permissions: ["clients.view"], settingsSchema: { clientId: { type: "select", source: "clients", required: true } } }),
  w({ key: "project-progress", name: "Project progress", category: "Clients & projects", description: "Delivery progress against active projects and approaching due dates.", dataContract: "list: project, client, progress, status and deadline", permissions: ["projects.view"], defaultWidth: 6 }),
  w({ key: "task-board", name: "Task board", category: "Clients & projects", description: "Tasks grouped into backlog, active, review and complete lanes.", dataContract: "board: tasks grouped by workflow status", permissions: ["tasks.view"], defaultWidth: 8, defaultHeight: 4 }),
  w({ key: "calendar-deadlines", name: "Calendar & deadlines", category: "Clients & projects", description: "A practical agenda of dated delivery and renewal commitments.", dataContract: "list: combined project, task and subscription dates", permissions: ["projects.view"] }),
  w({ key: "team-capacity", name: "Assigned team", category: "Clients & projects", description: "Open assignments and estimated hours grouped by team member.", dataContract: "list: user, open tasks, estimated hours", permissions: ["tasks.view"] }),
  w({ key: "project-activity", name: "Project activity feed", category: "Clients & projects", description: "Audited changes to projects, tasks, websites and client records.", dataContract: "list: filtered audit events", permissions: ["projects.view"] }),
  w({ key: "notes-links", name: "Notes & internal links", category: "Clients & projects", description: "Operator-authored project notes and approved internal references.", dataContract: "custom: settings.markdown and settings.links", permissions: ["dashboards.view"], settingsSchema: { markdown: { type: "textarea" }, links: { type: "links" } } }),
  w({ key: "client-websites", name: "Client website links", category: "Clients & projects", description: "Production, preview and repository links from the website inventory.", dataContract: "table: website, client, URLs and host", permissions: ["websites.view"] }),
  w({ key: "renewal-reminders", name: "Contract & subscription reminders", category: "Clients & projects", description: "Upcoming recurring service renewals with client and value.", dataContract: "list: subscription renewal, amount and status", permissions: ["finance.view"] }),

  w({ key: "repository-inventory", name: "Repository inventory", category: "Development & GitHub", description: "Authorized GitHub repositories with visibility, language and default branch.", dataContract: "table: cached GET /user/repos repository records", permissions: ["integrations.view"], dependencies: ["github"], defaultWidth: 6 }),
  w({ key: "recent-commits", name: "Recent commits", category: "Development & GitHub", description: "Recent commits fetched from explicitly authorized repositories.", dataContract: "list: cached GitHub commit records with SHA links", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "open-issues", name: "Open issues", category: "Development & GitHub", description: "Open issues across synchronized repositories, excluding pull requests.", dataContract: "list: cached GitHub issues with repository and labels", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "pull-requests", name: "Pull requests awaiting review", category: "Development & GitHub", description: "Open pull requests with author, branch and review-facing links.", dataContract: "list: cached GitHub pull request records", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "branch-activity", name: "Branch activity", category: "Development & GitHub", description: "Branches returned by the provider with protected status where available.", dataContract: "list: cached GitHub branch records", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "workflow-status", name: "Workflow status", category: "Development & GitHub", description: "Recent GitHub Actions runs and their reported conclusions.", dataContract: "list: cached Actions runs with event and conclusion", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "release-activity", name: "Release activity", category: "Development & GitHub", description: "Published and draft releases from synchronized repositories.", dataContract: "list: cached GitHub releases and publication dates", permissions: ["integrations.view"], dependencies: ["github"] }),
  w({ key: "repository-links", name: "Repository links", category: "Development & GitHub", description: "Project-to-repository mappings maintained in the agency inventory.", dataContract: "links: project repository URLs", permissions: ["projects.view"] }),
  w({ key: "deployment-references", name: "Deployment references", category: "Development & GitHub", description: "Provider deployment IDs, environments and inspected URLs.", dataContract: "list: cached Vercel and Coolify deployment references", permissions: ["integrations.view"], dependencies: ["vercel", "coolify"] }),
  w({ key: "development-notes", name: "Development notes", category: "Development & GitHub", description: "Repository-specific implementation notes for OpenCode-led delivery.", dataContract: "custom: settings.markdown and repository mapping", permissions: ["projects.view"], settingsSchema: { markdown: { type: "textarea" }, repositoryUrl: { type: "url" } } }),

  w({ key: "vercel-projects", name: "Vercel projects", category: "Hosting & infrastructure", description: "Actual project inventory cached from the Vercel account API.", dataContract: "table: cached GET /v9/projects records", permissions: ["integrations.view"], dependencies: ["vercel"] }),
  w({ key: "latest-deployments", name: "Latest deployment status", category: "Hosting & infrastructure", description: "Current build states and commit metadata from deployment providers.", dataContract: "list: cached deployment state, target and created time", permissions: ["integrations.view"], dependencies: ["vercel", "coolify"] }),
  w({ key: "preview-links", name: "Preview & production links", category: "Hosting & infrastructure", description: "Inventory URLs plus provider-returned aliases, clearly sourced.", dataContract: "links: production and preview URLs", permissions: ["websites.view"] }),
  w({ key: "coolify-apps", name: "Coolify applications", category: "Hosting & infrastructure", description: "Applications visible to the configured team-scoped read token.", dataContract: "table: cached GET /api/v1/applications records", permissions: ["integrations.view"], dependencies: ["coolify"] }),
  w({ key: "deployment-history", name: "Deployment history", category: "Hosting & infrastructure", description: "Chronological provider deployment history with cached-at timestamps.", dataContract: "list: cached deployment history", permissions: ["integrations.view"], dependencies: ["vercel", "coolify"] }),
  w({ key: "application-health", name: "Application health", category: "Hosting & infrastructure", description: "Only health states explicitly returned by configured providers or checks.", dataContract: "health: provider application health records", permissions: ["integrations.view"], dependencies: ["coolify"] }),
  w({ key: "uptime-checks", name: "Uptime checks", category: "Hosting & infrastructure", description: "Recorded website checks with response state and last verified time.", dataContract: "list: website status and lastCheckedAt; no inferred uptime percentage", permissions: ["websites.view"] }),
  w({ key: "domain-inventory", name: "Domain inventory", category: "Hosting & infrastructure", description: "Managed domains and Cloudflare zone data where synchronized.", dataContract: "table: inventory domains and optional cached zones", permissions: ["websites.view"] }),
  w({ key: "ssl-expiry", name: "SSL expiry monitoring", category: "Hosting & infrastructure", description: "Recorded certificate dates or provider-returned certificate metadata.", dataContract: "list: sourced SSL expiry dates; never guessed", permissions: ["websites.view"] }),
  w({ key: "vps-resources", name: "VPS resource metrics", category: "Hosting & infrastructure", description: "Server inventory and metrics only when a supported monitoring endpoint supplies them.", dataContract: "metric: cached provider metrics; empty if unavailable", permissions: ["integrations.view"], dependencies: ["upcloud"] }),
  w({ key: "service-health", name: "Background service health", category: "Hosting & infrastructure", description: "Integration connectivity, sync failures and background job state.", dataContract: "health: integrations, sync runs and failed jobs", permissions: ["integrations.view"] }),

  w({ key: "opencode-links", name: "OpenCode workspace", category: "AI & automation", description: "Primary development environment entry points and project mappings.", dataContract: "links: configured OpenCode URL and project repositories", permissions: ["projects.view"], dependencies: ["opencode"] }),
  w({ key: "opencode-status", name: "OpenCode task status", category: "AI & automation", description: "Health and session status from an explicitly configured opencode serve endpoint.", dataContract: "health: cached /global/health and /session/status", permissions: ["integrations.view"], dependencies: ["opencode"] }),
  w({ key: "agent-activity", name: "Agent activity feed", category: "AI & automation", description: "Recorded OpenCode session status; no activity is inferred without an event source.", dataContract: "list: cached supported OpenCode session events", permissions: ["integrations.view"], dependencies: ["opencode"] }),
  w({ key: "automation-inventory", name: "Automation inventory", category: "AI & automation", description: "Known workflows grouped by source and latest execution state.", dataContract: "table: automation run names, sources and states", permissions: ["operations.view"] }),
  w({ key: "workflow-runs", name: "Workflow execution history", category: "AI & automation", description: "Actual recorded automation executions with duration and outcome.", dataContract: "list: persisted automation runs", permissions: ["operations.view"] }),
  w({ key: "failed-runs", name: "Failed runs", category: "AI & automation", description: "Failures requiring operator attention, with safe error summaries.", dataContract: "list: failed automation and sync runs", permissions: ["operations.view"] }),
  w({ key: "queue-status", name: "Queue status", category: "AI & automation", description: "Queued, running and failed background jobs from the database queue.", dataContract: "metric: background jobs grouped by status", permissions: ["operations.view"], refreshInterval: 60 }),
  w({ key: "model-provider-links", name: "Model provider configuration", category: "AI & automation", description: "Direct links to OpenRouter and local model administration surfaces.", dataContract: "links: configured provider consoles", permissions: ["integrations.view"] }),
  w({ key: "api-usage", name: "API usage & cost", category: "AI & automation", description: "Provider-returned credit or usage fields without locally invented pricing.", dataContract: "metric: cached OpenRouter account response fields", permissions: ["integrations.view"], dependencies: ["openrouter"] }),

  w({ key: "invoice-totals", name: "Invoice totals", category: "Finance", description: "Gross invoiced totals separated from payments and recurring revenue.", dataContract: "metric: sum invoice totalMinor by currency", permissions: ["finance.view"] }),
  w({ key: "paid-invoices", name: "Paid invoices", category: "Finance", description: "Fully paid invoices and actual amountPaidMinor totals.", dataContract: "table: paid invoice records", permissions: ["finance.view"] }),
  w({ key: "outstanding-invoices", name: "Outstanding invoices", category: "Finance", description: "Unpaid and partially paid balances not yet overdue.", dataContract: "metric: outstanding balance and count", permissions: ["finance.view"] }),
  w({ key: "overdue-payments", name: "Overdue payments", category: "Finance", description: "Open invoices whose due date precedes today.", dataContract: "list: overdue invoice aging and balance", permissions: ["finance.view"] }),
  w({ key: "monthly-revenue", name: "Monthly revenue", category: "Finance", description: "Invoiced totals by issue month and cash received by payment month.", dataContract: "series: monthly invoiced and received minor units", permissions: ["finance.view"], defaultWidth: 8 }),
  w({ key: "recurring-revenue", name: "Recurring revenue", category: "Finance", description: "Normalized monthly recurring value for active subscriptions.", dataContract: "metric: active subscription MRR, distinct from invoiced revenue", permissions: ["finance.view"] }),
  w({ key: "client-subscriptions", name: "Client subscriptions", category: "Finance", description: "Recurring plans, statuses, values and renewal dates.", dataContract: "table: subscription records joined to clients", permissions: ["finance.view"] }),
  w({ key: "service-renewals", name: "Service renewals", category: "Finance", description: "Renewals in the next 60 days with accountable client.", dataContract: "list: upcoming subscription renewals", permissions: ["finance.view"] }),
  w({ key: "project-profitability", name: "Project profitability", category: "Finance", description: "Project budget less attributed recorded expenses; blank without cost data.", dataContract: "table: budget, recorded costs and estimated margin", permissions: ["finance.view"] }),
  w({ key: "invoiceshelf-records", name: "InvoiceShelf synchronized records", category: "Finance", description: "Customers, invoices and payments returned by the probed InvoiceShelf API, with source freshness and no accounting remapping.", dataContract: "list: cached InvoiceShelf invoices, customers and payments", permissions: ["finance.view"], dependencies: ["invoiceshelf"], defaultWidth: 6 }),
  w({ key: "expense-margins", name: "Expenses & estimated margins", category: "Finance", description: "Recorded expenses alongside invoiced revenue with an explicitly estimated margin.", dataContract: "metric: expense totals and revenue-less-expenses estimate", permissions: ["finance.view"] }),

  w({ key: "bookmarks", name: "Bookmark collection", category: "Custom information", description: "Curated operator bookmarks stored in widget settings.", dataContract: "links: settings.links[{label,url}]", permissions: ["dashboards.view"], settingsSchema: { links: { type: "links", required: true } } }),
  w({ key: "external-links", name: "External website links", category: "Custom information", description: "Approved external tools and website destinations.", dataContract: "links: settings.links with http/https validation", permissions: ["dashboards.view"], settingsSchema: { links: { type: "links" } } }),
  w({ key: "custom-notes", name: "Custom text & notes", category: "Custom information", description: "Plain-text operational notes rendered without arbitrary HTML execution.", dataContract: "custom: safe plain-text settings.markdown", permissions: ["dashboards.view"], settingsSchema: { markdown: { type: "textarea", maxLength: 10000 } } }),
  w({ key: "calendar-embed", name: "Calendar embed", category: "Custom information", description: "An allowlisted HTTPS calendar embed with sandbox restrictions.", dataContract: "embed: validated settings.url; approved hosts only", permissions: ["dashboards.view"], settingsSchema: { url: { type: "url", required: true } } }),
  w({ key: "rss-feed", name: "RSS feed", category: "Custom information", description: "Server-fetched RSS items from an approved HTTPS host with caching and timeouts.", dataContract: "list: mapped RSS title, link and publication date", permissions: ["dashboards.view"], settingsSchema: { url: { type: "url", required: true } }, refreshInterval: 900 }),
  w({ key: "status-pages", name: "Status pages", category: "Custom information", description: "Links to public provider and client status pages.", dataContract: "links: settings.links", permissions: ["dashboards.view"], settingsSchema: { links: { type: "links" } } }),
  w({ key: "api-data-card", name: "API-backed data card", category: "Custom information", description: "A single value mapped from an approved JSON endpoint with timeout and clear errors.", dataContract: "metric: settings.url, settings.valuePath and optional labelPath", permissions: ["integrations.view"], settingsSchema: { url: { type: "url", required: true }, valuePath: { type: "text", required: true }, labelPath: { type: "text" } }, refreshInterval: 120 }),
  w({ key: "json-endpoint", name: "JSON endpoint", category: "Custom information", description: "Map an allowlisted JSON array into a compact list without executing response content.", dataContract: "list: settings.url, itemsPath, labelPath and secondaryPath", permissions: ["integrations.view"], settingsSchema: { url: { type: "url", required: true }, itemsPath: { type: "text" }, labelPath: { type: "text", required: true }, secondaryPath: { type: "text" } }, refreshInterval: 120 }),
  w({ key: "webhook-activity", name: "Webhook activity", category: "Custom information", description: "Received webhook metadata and processing state without sensitive request bodies.", dataContract: "list: provider, event type, external ID and received time", permissions: ["integrations.view"] }),
  w({ key: "documentation-links", name: "Documentation links", category: "Custom information", description: "Runbooks, internal documentation and official provider references.", dataContract: "links: settings.links plus integration documentation", permissions: ["dashboards.view"], settingsSchema: { links: { type: "links" } } }),
  w({ key: "image-tile", name: "Custom image / logo tile", category: "Custom information", description: "A validated remote HTTPS image with an accessible label; no uploaded markup or script.", dataContract: "image: settings.url and settings.alt", permissions: ["dashboards.view"], settingsSchema: { url: { type: "url", required: true }, alt: { type: "text", required: true } } }),
];

export const WIDGET_CATEGORIES = [...new Set(WIDGET_REGISTRY.map((widget) => widget.category))];
export const widgetByKey = (key: string) => WIDGET_REGISTRY.find((widget) => widget.key === key);
