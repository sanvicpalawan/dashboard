import { randomBytes } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  appSettings,
  auditEvents,
  automationRuns,
  backgroundJobs,
  clients,
  dashboardVersions,
  dashboards,
  expenses,
  incidents,
  integrations,
  invoices,
  notifications,
  projects,
  projectComments,
  projectLinks,
  projectMedia,
  prospectActivities,
  prospects,
  roles,
  services,
  subscriptions,
  tasks,
  teams,
  themes,
  toolComments,
  toolFiles,
  toolLinks,
  toolMedia,
  tools,
  userPreferences,
  users,
  websites,
  widgetDefinitions,
  widgetInstances,
  workspaces,
} from "@/db/schema";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { INTEGRATION_DEFINITIONS } from "@/lib/integrations";
import { THEME_PRESETS } from "@/lib/themes";
import { WIDGET_REGISTRY, widgetByKey } from "@/lib/widget-registry";
import { hashPassword } from "@/lib/security";
import { demoModeEnabled } from "@/lib/demo";

const day = (offset: number) => {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

let bootstrapPromise: Promise<void> | null = null;

async function bootstrap() {
  const demo = demoModeEnabled();
  await db.insert(roles).values(DEFAULT_ROLES.map((role) => ({ ...role, permissions: [...role.permissions] }))).onConflictDoNothing();
  // Additive permission sync: newly introduced module permissions are granted to system roles without removing administrator customizations.
  const existingRoles = await db.select().from(roles);
  for (const defaults of DEFAULT_ROLES) {
    const current = existingRoles.find((role) => role.slug === defaults.slug);
    if (!current || current.permissions.includes("*")) continue;
    const missing = defaults.permissions.filter((permission) => !current.permissions.includes(permission));
    if (missing.length) await db.update(roles).set({ permissions: [...current.permissions, ...missing], updatedAt: new Date() }).where(eq(roles.id, current.id));
  }
  await db.insert(themes).values(THEME_PRESETS.map((theme) => ({ ...theme, builtIn: true, isDefault: Boolean(theme.isDefault) }))).onConflictDoNothing();
  await db.insert(widgetDefinitions).values(WIDGET_REGISTRY).onConflictDoNothing();

  const [workspace] = await db.insert(workspaces).values({
    name: "Palawan Collective + MerQato.digital",
    slug: "palawan-merqato",
    legalName: "Palawan Collective / MerQato.digital",
    brandMark: "PC",
    demoMode: demo,
    settings: { positioning: "Local businesses. Distinct digital worlds.", location: "Palawan, Philippines" },
  }).onConflictDoNothing().returning();
  const workspaceRecord = workspace ?? (await db.select().from(workspaces).where(eq(workspaces.slug, "palawan-merqato")).limit(1))[0];
  if (!workspaceRecord) throw new Error("Workspace bootstrap failed.");

  await db.insert(integrations).values(INTEGRATION_DEFINITIONS.map((definition) => ({
    workspaceId: workspaceRecord.id,
    key: definition.key,
    name: definition.name,
    category: definition.category,
    description: definition.description,
    authMethod: definition.authMethod,
    docsUrl: definition.docsUrl,
    capabilities: definition.capabilities,
    scopes: definition.scopes,
    baseUrl: definition.baseUrl || null,
    enabled: definition.enabled ?? true,
    config: { configurableUrl: Boolean(definition.configurableUrl), secretLabel: definition.secretLabel, limitation: definition.limitation },
  }))).onConflictDoNothing();

  await db.insert(appSettings).values({
    key: `workspace:${workspaceRecord.id}`,
    value: {
      applicationName: "Palawan Collective",
      coBrand: "Command Center",
      locale: "en-PH",
      timezone: "Asia/Manila",
      currency: "PHP",
      dateFormat: "medium",
      weekStartsOn: 1,
      allowUserThemes: true,
      allowUserLayouts: true,
      auditRetentionDays: 365,
      sessionHours: 12,
      healthCheckSeconds: 60,
      syncIntervalMinutes: 30,
      maintenanceMode: false,
      navigation: ["Overview", "Clients", "Projects", "Websites", "Services", "Finance", "Operations"],
      allowedOutboundHosts: ["api.github.com", "api.vercel.com", "api.cloudflare.com", "openrouter.ai"],
      backupSchedule: "0 2 * * *",
      version: "1.0.0",
    },
  }).onConflictDoNothing();

  const [role] = await db.select().from(roles).where(eq(roles.slug, "super-admin")).limit(1);
  if (!role) throw new Error("Default role bootstrap failed.");
  const [userCount] = await db.select({ value: count() }).from(users);
  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || "merqatodigital@proton.me";
  const adminEmailConfigured = Boolean(process.env.BOOTSTRAP_ADMIN_EMAIL);
  let admin = (await db.select().from(users).where(eq(users.email, adminEmail)).limit(1))[0];
  // An empty users table is the normal first run. A named BOOTSTRAP_ADMIN_EMAIL is
  // honoured as well, otherwise a database that already holds any account — a demo
  // seed, a previous environment — silently never creates the administrator the
  // configuration asks for, and the first sign-in fails with "Email or password is
  // incorrect" against an account that was never inserted. This only ever creates
  // the missing account; it never modifies or replaces an existing one.
  if (!admin && (Number(userCount.value) === 0 || adminEmailConfigured)) {
    // A fixed default password is never used: the demo path signs in without one, and real use
    // requires an explicit BOOTSTRAP_ADMIN_PASSWORD (or a rotated password via the admin script).
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || randomBytes(24).toString("base64url");
    if (!password) throw new Error("Set BOOTSTRAP_ADMIN_PASSWORD for the initial administrator.");
    [admin] = await db.insert(users).values({
      workspaceId: workspaceRecord.id,
      roleId: role.id,
      name: "MerQato Administrator",
      email: adminEmail,
      passwordHash: hashPassword(password),
      title: "Agency Operations",
      mustChangePassword: !demo,
    }).returning();
  }

  const [defaultTheme] = await db.select().from(themes).where(eq(themes.slug, "merqato-midnight")).limit(1);
  if (admin && defaultTheme) {
    await db.insert(userPreferences).values({ userId: admin.id, themeId: defaultTheme.id }).onConflictDoNothing();
  }

  const [teamCount] = await db.select({ value: count() }).from(teams).where(eq(teams.workspaceId, workspaceRecord.id));
  let deliveryTeam = (await db.select().from(teams).where(eq(teams.workspaceId, workspaceRecord.id)).limit(1))[0];
  if (Number(teamCount.value) === 0) {
    [deliveryTeam] = await db.insert(teams).values([
      { workspaceId: workspaceRecord.id, name: "Digital Studio", slug: "digital-studio", description: "Strategy, design and web engineering for client launches.", color: "#91a0ff" },
      { workspaceId: workspaceRecord.id, name: "Systems & Automation", slug: "systems-automation", description: "AI-assisted development, internal tooling and managed operations.", color: "#68d6b2" },
      { workspaceId: workspaceRecord.id, name: "Client Partnerships", slug: "client-partnerships", description: "Discovery, account planning, commercial operations and support.", color: "#e3b45c" },
    ]).returning();
  }

  if (demo) {
    await seedDemo(workspaceRecord.id, admin?.id ?? null, deliveryTeam?.id ?? null);
    await seedExpenses(workspaceRecord.id);
    await seedProjectExtras(workspaceRecord.id, admin?.id ?? null);
    await seedProspects(workspaceRecord.id, admin?.id ?? null);
    await seedTools(workspaceRecord.id, admin?.id ?? null);
  }
  await seedDashboards(workspaceRecord.id, admin?.id ?? null, deliveryTeam?.id ?? null);
}

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600000);

async function seedExpenses(workspaceId: string) {
  const [existing] = await db.select({ value: count() }).from(expenses).where(eq(expenses.workspaceId, workspaceId));
  if (Number(existing.value) > 0) return;
  const clientRows = await db.select().from(clients).where(eq(clients.workspaceId, workspaceId));
  const projectRows = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
  const c = (index: number) => clientRows[index]?.id ?? null;
  const p = (index: number) => projectRows[index]?.id ?? null;
  const monthlyExpenses = (offsetDays: number) => [
    { category: "VPS & hosting", vendor: "UpCloud", description: "Production VPS — 4 vCPU / 8 GB (Coolify host)", amountMinor: 268000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(30 - (offsetDays % 30)) },
    { category: "VPS & hosting", vendor: "Vercel", description: "Vercel Pro — preview deployments", amountMinor: 112000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(12) },
    { category: "Database & storage", vendor: "Neon", description: "Neon Postgres Launch plan", amountMinor: 106000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(18) },
    { category: "Database & storage", vendor: "Supabase", description: "Supabase Pro — client auth & storage", amountMinor: 140000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(21) },
    { category: "Database & storage", vendor: "Cloudflare R2", description: "Object storage for media and backups", amountMinor: 38000, billingCycle: "usage-based", paymentMethod: "Company card" },
    { category: "LLM & AI usage", vendor: "OpenRouter", description: "Model usage — client agents and internal tooling", amountMinor: 482000, billingCycle: "usage-based", paymentMethod: "Prepaid credits" },
    { category: "LLM & AI usage", vendor: "Anthropic", description: "Claude API — OpenCode development sessions", amountMinor: 356000, billingCycle: "usage-based", paymentMethod: "Company card" },
    { category: "Software subscriptions", vendor: "GitHub", description: "GitHub Team — 5 seats", amountMinor: 112000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(9) },
    { category: "Software subscriptions", vendor: "Figma", description: "Figma Professional — 2 editors", amountMinor: 168000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(15) },
    { category: "Software subscriptions", vendor: "Google Workspace", description: "Business Starter — 6 users", amountMinor: 201600, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(4) },
    { category: "Software subscriptions", vendor: "Notion", description: "Notion Plus — team docs", amountMinor: 112000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(26) },
    { category: "Email & messaging", vendor: "Resend", description: "Transactional email for client sites", amountMinor: 112000, billingCycle: "monthly", paymentMethod: "Company card", nextRenewalAt: day(7) },
    { category: "Email & messaging", vendor: "Twilio", description: "WhatsApp Business API conversations", amountMinor: 154000, billingCycle: "usage-based", paymentMethod: "Prepaid credits" },
    { category: "Office & rent", vendor: "Puerto Princesa co-working", description: "Shared studio desk rental — 3 desks", amountMinor: 1500000, billingCycle: "monthly", paymentMethod: "Bank transfer", nextRenewalAt: day(1) },
    { category: "Internet & utilities", vendor: "PLDT / Starlink", description: "Fiber + Starlink backup connectivity", amountMinor: 689900, billingCycle: "monthly", paymentMethod: "Bank transfer", nextRenewalAt: day(10) },
    { category: "Salaries & benefits", vendor: "Payroll", description: "Team payroll and contributions", amountMinor: 18500000, billingCycle: "monthly", paymentMethod: "Bank transfer" },
  ].map((item) => ({ ...item, workspaceId, currency: "PHP", status: "paid" as const, notes: "Demo expense record" }));

  await db.insert(expenses).values([
    ...[0, 1, 2, 3, 4, 5].flatMap((monthsAgo) => { const base = new Date(); base.setUTCDate(3); base.setUTCMonth(base.getUTCMonth() - monthsAgo); const incurredAt = base.toISOString().slice(0, 10); return monthlyExpenses(monthsAgo * 30).map((item, index) => ({ ...item, incurredAt, amountMinor: Math.round(item.amountMinor * (item.billingCycle === "usage-based" ? 0.7 + ((monthsAgo + index) % 4) * 0.18 : 1)), nextRenewalAt: monthsAgo === 0 ? item.nextRenewalAt ?? null : null })); }),
    { workspaceId, category: "Domains & DNS", vendor: "Cloudflare Registrar", description: "Domain renewals — merqato.digital, palawancollective.com + 6 client domains", amountMinor: 624000, currency: "PHP", billingCycle: "yearly", status: "paid", paymentMethod: "Company card", incurredAt: day(-40), nextRenewalAt: day(325), notes: "Demo expense record" },
    { workspaceId, category: "Supplies & equipment", vendor: "Lazada", description: "27\" monitor and USB-C dock for design workstation", amountMinor: 2349900, currency: "PHP", billingCycle: "one-time", status: "paid", paymentMethod: "Company card", incurredAt: day(-22), notes: "Demo expense record" },
    { workspaceId, category: "Supplies & equipment", vendor: "National Book Store", description: "Printer paper, notebooks, whiteboard markers", amountMinor: 186500, currency: "PHP", billingCycle: "one-time", status: "paid", paymentMethod: "Cash", incurredAt: day(-6), notes: "Demo expense record" },
    { workspaceId, clientId: c(3), projectId: p(3), category: "Contractors & freelancers", description: "Freelance copywriter — Isla guest brief templates", amountMinor: 1800000, currency: "PHP", billingCycle: "one-time", status: "paid", paymentMethod: "GCash", incurredAt: day(-14), notes: "Demo expense record" },
    { workspaceId, projectId: p(1), category: "Contractors & freelancers", description: "Independent accessibility audit — Tala Studio", amountMinor: 650000, currency: "PHP", billingCycle: "one-time", status: "pending", paymentMethod: "Bank transfer", incurredAt: day(-11), notes: "Demo expense record" },
    { workspaceId, category: "Marketing & advertising", vendor: "Meta Ads", description: "Instagram lead-gen campaign — Palawan resorts", amountMinor: 850000, currency: "PHP", billingCycle: "one-time", status: "paid", paymentMethod: "Company card", incurredAt: day(-18), notes: "Demo expense record" },
    { workspaceId, category: "Travel & client meetings", vendor: "Cebu Pacific / van hire", description: "El Nido client visits — Nacpan & Daluyon", amountMinor: 1240000, currency: "PHP", billingCycle: "one-time", status: "paid", paymentMethod: "Company card", incurredAt: day(-9), notes: "Demo expense record" },
    { workspaceId, category: "Payment & bank fees", vendor: "Wise / BPI", description: "International card & transfer fees", amountMinor: 64200, currency: "PHP", billingCycle: "monthly", status: "paid", paymentMethod: "Bank", incurredAt: day(-2), notes: "Demo expense record" },
    { workspaceId, category: "Training & education", vendor: "Frontend Masters", description: "Team learning subscription", amountMinor: 224000, currency: "PHP", billingCycle: "yearly", status: "paid", paymentMethod: "Company card", incurredAt: day(-60), nextRenewalAt: day(305), notes: "Demo expense record" },
    { workspaceId, category: "Taxes & government fees", vendor: "BIR", description: "Quarterly percentage tax", amountMinor: 1560000, currency: "PHP", billingCycle: "one-time", status: "pending", paymentMethod: "Bank transfer", incurredAt: day(-1), nextRenewalAt: day(20), notes: "Demo expense record" },
  ]);

}

async function seedProjectExtras(workspaceId: string, adminId: string | null) {
  const projectRows = await db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
  if (!projectRows.length) return;
  const [existing] = await db.select({ value: count() }).from(projectComments).innerJoin(projects, eq(projects.id, projectComments.projectId)).where(eq(projects.workspaceId, workspaceId));
  if (Number(existing.value) > 0) return;
  const people = await db.select().from(users).where(eq(users.workspaceId, workspaceId));
  const by = (fragment: string) => people.find((person) => person.email.startsWith(fragment))?.id ?? adminId;
  const images = [
    "https://images.pexels.com/photos/33549424/pexels-photo-33549424.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    "https://images.pexels.com/photos/33549432/pexels-photo-33549432.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    "https://images.pexels.com/photos/33549434/pexels-photo-33549434.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    "https://images.pexels.com/photos/3507996/pexels-photo-3507996.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    "https://images.pexels.com/photos/36758188/pexels-photo-36758188.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
    "https://images.pexels.com/photos/36758179/pexels-photo-36758179.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
  ];
  for (const [index, project] of projectRows.entries()) {
    const slug = project.code.toLowerCase();
    await db.insert(projectLinks).values([
      { projectId: project.id, createdBy: adminId, label: "Production website", url: `https://${slug}.example`, kind: "production" },
      { projectId: project.id, createdBy: by("paolo"), label: "Preview deployment", url: `https://${slug}-preview.example`, kind: "preview" },
      ...(project.repositoryUrl ? [{ projectId: project.id, createdBy: by("paolo"), label: "GitHub repository", url: project.repositoryUrl, kind: "repository" }] : []),
      { projectId: project.id, createdBy: by("mika"), label: "Figma design system", url: `https://www.figma.com/files/${slug}-design`, kind: "design" },
      { projectId: project.id, createdBy: by("aya"), label: "Client brief & approvals", url: `https://docs.example.com/${slug}/brief`, kind: "document" },
    ]);
    await db.insert(projectMedia).values([
      { projectId: project.id, uploadedBy: by("mika"), type: "image", url: images[index % images.length], caption: "Hero art direction reference (demo stock image)" },
      { projectId: project.id, uploadedBy: by("paolo"), type: "image", url: images[(index + 2) % images.length], caption: "Mobile layout review capture (demo stock image)" },
      { projectId: project.id, uploadedBy: by("aya"), type: "image", url: images[(index + 4) % images.length], caption: "Client-supplied location photography (demo stock image)" },
      { projectId: project.id, uploadedBy: by("paolo"), type: "video", url: "https://www.youtube.com/embed/ysz5S6PUM-U", caption: "Prototype walkthrough recording (demo embed)" },
    ]);
    await db.insert(projectComments).values([
      { projectId: project.id, userId: by("mika"), body: `Kickoff recap for ${project.name}: scope confirmed with the client, deliverables locked, and the first design review is scheduled for Thursday.`, attachments: [], createdAt: hoursAgo(96 + index) },
      { projectId: project.id, userId: by("paolo"), body: "Staging is live on the preview link. Mobile navigation and the hero sequence are ready for review — please check on a real device before Friday.", attachments: [{ url: images[(index + 1) % images.length], name: "staging-mobile-review.jpg" }], createdAt: hoursAgo(40 + index) },
      { projectId: project.id, userId: by("aya"), body: "Client feedback received: they love the direction. Two copy changes on the services section and a request to add WhatsApp contact in the footer.", attachments: [], createdAt: hoursAgo(18 + index) },
      { projectId: project.id, userId: adminId, body: "Approved for the next sprint. Keep the launch checklist updated here so the whole team sees status without another meeting.", attachments: [], createdAt: hoursAgo(5 + index) },
    ]);
  }
}

async function seedProspects(workspaceId: string, adminId: string | null) {
  const [existing] = await db.select({ value: count() }).from(prospects).where(eq(prospects.workspaceId, workspaceId));
  if (Number(existing.value) > 0) return;
  const people = await db.select().from(users).where(eq(users.workspaceId, workspaceId));
  const by = (fragment: string) => people.find((person) => person.email.startsWith(fragment))?.id ?? adminId;
  const rows = await db.insert(prospects).values([
    { workspaceId, ownerId: by("aya"), businessName: "Kalui Seafood Kitchen", contactName: "Rosa Bautista", email: "rosa@kalui.example", phone: "+63 917 220 1101", whatsapp: "+63 917 220 1101", website: "https://kalui.example", socialLinks: "instagram.com/kaluikitchen", industry: "Restaurant", location: "Puerto Princesa, Palawan", source: "Instagram outreach", stage: "pitched", pitchedServices: ["Website", "Online reservations automation"], estimatedValueMinor: 16500000, notes: "Busy on weekends; owner prefers WhatsApp voice notes. Wants menu + reservations before peak season.", lastContactAt: hoursAgo(30), nextFollowUpAt: day(2) },
    { workspaceId, ownerId: by("aya"), businessName: "Daluyon Island Hopping", contactName: "Jun Magbanua", email: "jun@daluyon.example", phone: "+63 918 400 2210", whatsapp: "+63 918 400 2210", website: "", socialLinks: "facebook.com/daluyontours", industry: "Tours", location: "El Nido, Palawan", source: "Referral — Isla Expeditions", stage: "negotiating", pitchedServices: ["Booking website", "AI inquiry agent", "WhatsApp automation"], estimatedValueMinor: 28000000, notes: "Loses bookings to slow replies. Comparing us with a freelancer; price-sensitive but convinced by the agent demo.", lastContactAt: hoursAgo(8), nextFollowUpAt: day(1) },
    { workspaceId, ownerId: by("mika"), businessName: "Puerto Dental Studio", contactName: "Dr. Celine Ramos", email: "celine@puertodental.example", phone: "+63 919 555 0199", whatsapp: "+63 919 555 0199", website: "https://puertodental.example", socialLinks: "", industry: "Healthcare", location: "Puerto Princesa, Palawan", source: "Cold email", stage: "contacted", pitchedServices: ["Website redesign", "Appointment automation"], estimatedValueMinor: 12000000, notes: "Opened email twice, no reply yet. Try WhatsApp after clinic hours.", lastContactAt: hoursAgo(72), nextFollowUpAt: day(3) },
    { workspaceId, ownerId: by("aya"), businessName: "Mangrove Eco Lodge", contactName: "Teo Alvarez", email: "teo@mangrovelodge.example", phone: "+63 920 777 3030", whatsapp: "+63 920 777 3030", website: "https://mangrovelodge.example", socialLinks: "instagram.com/mangroveecolodge", industry: "Hospitality", location: "San Vicente, Palawan", source: "Walk-in meeting", stage: "won", pitchedServices: ["Direct booking website", "Hosting & maintenance"], estimatedValueMinor: 32000000, notes: "Signed proposal; onboarding call scheduled. Convert to client record after deposit.", lastContactAt: hoursAgo(20) },
    { workspaceId, ownerId: by("mika"), businessName: "Coron Motor Rentals", contactName: "Bea Santiago", email: "bea@coronmotors.example", phone: "+63 921 300 4411", whatsapp: "+63 921 300 4411", website: "", socialLinks: "facebook.com/coronmotorrentals", industry: "Rentals", location: "Coron, Palawan", source: "Facebook message", stage: "declined", pitchedServices: ["Website", "Rental availability automation"], estimatedValueMinor: 9000000, notes: "Declined for now — using Facebook only. Revisit in Q4 when they open the second branch.", lastContactAt: hoursAgo(120), declinedAt: hoursAgo(120), declinedReason: "Budget allocated to new vehicles this year; happy with Facebook page for now." },
    { workspaceId, ownerId: by("aya"), businessName: "Baragatan Crafts Collective", contactName: "Lani Dizon", email: "lani@baragatan.example", phone: "+63 922 610 7788", whatsapp: "+63 922 610 7788", website: "https://baragatan.example", socialLinks: "instagram.com/baragatancrafts", industry: "Retail", location: "Puerto Princesa, Palawan", source: "Trade fair", stage: "pitched", pitchedServices: ["E-commerce website", "Social media management"], estimatedValueMinor: 21000000, notes: "Co-op of 14 artisans; decisions go through a monthly meeting. Sent proposal deck.", lastContactAt: hoursAgo(50), nextFollowUpAt: day(6) },
    { workspaceId, ownerId: by("mika"), businessName: "Taytay Fresh Market Delivery", contactName: "Marco Villar", email: "marco@taytayfresh.example", phone: "+63 923 118 9090", whatsapp: "+63 923 118 9090", website: "", socialLinks: "", industry: "Grocery delivery", location: "Taytay, Palawan", source: "LinkedIn", stage: "no_response", pitchedServices: ["Ordering web app", "Delivery notifications automation"], estimatedValueMinor: 18000000, notes: "Three touches, no reply. Park unless a referral opens the door.", lastContactAt: hoursAgo(240) },
    { workspaceId, ownerId: by("aya"), businessName: "Sunset Yoga Shala", contactName: "Ines Carlos", email: "ines@sunsetyoga.example", phone: "+63 924 777 1212", whatsapp: "+63 924 777 1212", website: "https://sunsetyoga.example", socialLinks: "instagram.com/sunsetyogashala", industry: "Wellness", location: "Port Barton, Palawan", source: "Referral — Tala Studio", stage: "new", pitchedServices: [], estimatedValueMinor: 9500000, notes: "Warm intro from Tala Studio owner. Research class schedule before first contact.", nextFollowUpAt: day(1) },
    { workspaceId, ownerId: by("mika"), businessName: "Palawan Pearl Traders", contactName: "Henry Lao", email: "henry@palawanpearls.example", phone: "+63 925 404 6161", whatsapp: "", website: "https://palawanpearls.example", socialLinks: "", industry: "Jewelry", location: "Puerto Princesa, Palawan", source: "Cold email", stage: "declined", pitchedServices: ["White-label e-commerce", "AI product assistant"], estimatedValueMinor: 25000000, notes: "Already engaged an agency in Manila last month.", lastContactAt: hoursAgo(200), declinedAt: hoursAgo(200), declinedReason: "Signed with a Manila agency two weeks before our pitch." },
    { workspaceId, ownerId: by("aya"), businessName: "Isla Verde Dive Resort", contactName: "Paulo Reyes", email: "paulo@islaverde.example", phone: "+63 926 909 2323", whatsapp: "+63 926 909 2323", website: "https://islaverde.example", socialLinks: "instagram.com/islaverdedive", industry: "Hospitality", location: "Coron, Palawan", source: "Instagram outreach", stage: "contacted", pitchedServices: ["Website", "Booking automation"], estimatedValueMinor: 30000000, notes: "Replied positively; manager wants a short call next week.", lastContactAt: hoursAgo(26), nextFollowUpAt: day(4) },
  ]).returning();
  const p = (name: string) => rows.find((row) => row.businessName === name)!.id;
  await db.insert(prospectActivities).values([
    { prospectId: p("Kalui Seafood Kitchen"), userId: by("aya"), channel: "instagram", type: "outreach", pitched: [], outcome: "positive", response: "Replied asking what a reservations website would cost.", note: "Initial DM referencing their weekend queue posts.", occurredAt: hoursAgo(120) },
    { prospectId: p("Kalui Seafood Kitchen"), userId: by("aya"), channel: "whatsapp", type: "pitch", pitched: ["Website", "Online reservations automation"], outcome: "positive", response: "Interested; asked us to send examples and pricing.", note: "Sent Nacpan case study and starter package.", occurredAt: hoursAgo(30) },
    { prospectId: p("Daluyon Island Hopping"), userId: by("aya"), channel: "call", type: "outreach", pitched: [], outcome: "positive", response: "Agreed to a demo after Jun described missed bookings.", note: "Referral intro from Isla Expeditions.", occurredAt: hoursAgo(72) },
    { prospectId: p("Daluyon Island Hopping"), userId: by("mika"), channel: "meeting", type: "pitch", pitched: ["Booking website", "AI inquiry agent", "WhatsApp automation"], outcome: "positive", response: "Impressed by the inquiry agent demo; wants a lower monthly fee.", note: "Proposal sent with phased delivery option.", occurredAt: hoursAgo(26) },
    { prospectId: p("Daluyon Island Hopping"), userId: by("aya"), channel: "whatsapp", type: "response", pitched: [], outcome: "neutral", response: "Comparing with a freelancer quote; decision by Friday.", note: "", occurredAt: hoursAgo(8) },
    { prospectId: p("Puerto Dental Studio"), userId: by("mika"), channel: "email", type: "outreach", pitched: ["Website redesign", "Appointment automation"], outcome: "pending", response: "", note: "Opened twice, no reply.", occurredAt: hoursAgo(72) },
    { prospectId: p("Mangrove Eco Lodge"), userId: by("aya"), channel: "in_person", type: "pitch", pitched: ["Direct booking website", "Hosting & maintenance"], outcome: "positive", response: "Loved the direct-booking angle versus OTA commissions.", note: "Met at the lodge; toured rooms for photography planning.", occurredAt: hoursAgo(150) },
    { prospectId: p("Mangrove Eco Lodge"), userId: adminId, channel: "email", type: "response", pitched: [], outcome: "won", response: "Signed proposal returned with deposit confirmation.", note: "Create client + project records on onboarding call.", occurredAt: hoursAgo(20) },
    { prospectId: p("Coron Motor Rentals"), userId: by("mika"), channel: "facebook", type: "outreach", pitched: ["Website", "Rental availability automation"], outcome: "neutral", response: "Asked for pricing.", note: "", occurredAt: hoursAgo(190) },
    { prospectId: p("Coron Motor Rentals"), userId: by("mika"), channel: "whatsapp", type: "response", pitched: [], outcome: "declined", response: "Budget allocated to new vehicles this year; happy with Facebook page for now.", note: "Revisit Q4.", occurredAt: hoursAgo(120) },
    { prospectId: p("Baragatan Crafts Collective"), userId: by("aya"), channel: "in_person", type: "outreach", pitched: [], outcome: "positive", response: "Collected contact details at the trade fair booth.", note: "", occurredAt: hoursAgo(140) },
    { prospectId: p("Baragatan Crafts Collective"), userId: by("aya"), channel: "email", type: "pitch", pitched: ["E-commerce website", "Social media management"], outcome: "pending", response: "Will present to the co-op meeting on the 15th.", note: "Proposal deck sent.", occurredAt: hoursAgo(50) },
    { prospectId: p("Taytay Fresh Market Delivery"), userId: by("mika"), channel: "linkedin", type: "outreach", pitched: ["Ordering web app"], outcome: "no_response", response: "", note: "Connection accepted, no reply.", occurredAt: hoursAgo(400) },
    { prospectId: p("Taytay Fresh Market Delivery"), userId: by("mika"), channel: "email", type: "outreach", pitched: ["Ordering web app", "Delivery notifications automation"], outcome: "no_response", response: "", note: "Follow-up #2.", occurredAt: hoursAgo(300) },
    { prospectId: p("Taytay Fresh Market Delivery"), userId: by("mika"), channel: "whatsapp", type: "outreach", pitched: [], outcome: "no_response", response: "", note: "Final nudge. Parking.", occurredAt: hoursAgo(240) },
    { prospectId: p("Palawan Pearl Traders"), userId: by("mika"), channel: "email", type: "pitch", pitched: ["White-label e-commerce", "AI product assistant"], outcome: "declined", response: "Signed with a Manila agency two weeks before our pitch.", note: "Keep for future AI assistant upsell.", occurredAt: hoursAgo(200) },
    { prospectId: p("Isla Verde Dive Resort"), userId: by("aya"), channel: "instagram", type: "outreach", pitched: ["Website", "Booking automation"], outcome: "positive", response: "Manager wants a short call next week.", note: "", occurredAt: hoursAgo(26) },
  ]);
}

async function seedDemo(workspaceId: string, adminId: string | null, teamId: string | null) {
  const [existing] = await db.select({ value: count() }).from(clients).where(eq(clients.workspaceId, workspaceId));
  if (Number(existing.value) > 0) return;

  const allRoles = await db.select().from(roles);
  const roleId = (slug: string) => allRoles.find((item) => item.slug === slug)?.id ?? allRoles[0].id;
  const teamMembers = adminId ? await db.insert(users).values([
    { workspaceId, roleId: roleId("agency-manager"), teamId, name: "Mika Santos", email: "mika@demo.merqato.local", passwordHash: hashPassword(randomBytes(24).toString("hex")), title: "Delivery Director" },
    { workspaceId, roleId: roleId("developer"), teamId, name: "Paolo Reyes", email: "paolo@demo.merqato.local", passwordHash: hashPassword(randomBytes(24).toString("hex")), title: "Lead Web Engineer" },
    { workspaceId, roleId: roleId("automation-operator"), teamId, name: "Inez Villanueva", email: "inez@demo.merqato.local", passwordHash: hashPassword(randomBytes(24).toString("hex")), title: "Automation Operator" },
    { workspaceId, roleId: roleId("finance-manager"), name: "Marco Lim", email: "marco@demo.merqato.local", passwordHash: hashPassword(randomBytes(24).toString("hex")), title: "Finance & Commercial" },
    { workspaceId, roleId: roleId("client-manager"), name: "Aya Fernandez", email: "aya@demo.merqato.local", passwordHash: hashPassword(randomBytes(24).toString("hex")), title: "Client Partner" },
  ]).onConflictDoNothing().returning() : [];
  const member = (index: number) => teamMembers[index]?.id ?? adminId;

  const clientRows = await db.insert(clients).values([
    { workspaceId, ownerId: member(4), name: "Nacpan Beach Resort", industry: "Hospitality", location: "El Nido, Palawan", status: "active", contactName: "Sofia Mendoza", email: "sofia@nacpan.example", phone: "+63 917 000 1421", servicePlan: "Digital Flagship + Care", health: "good", notes: "Direct-booking experience with multilingual room stories and seasonal campaign landing pages.", links: [{ label: "Brand library", url: "https://example.com/nacpan-brand" }] },
    { workspaceId, ownerId: member(4), name: "Tala Studio Palawan", industry: "Wellness", location: "Puerto Princesa, Palawan", status: "active", contactName: "Luisa Arce", email: "hola@tala.example", phone: "+63 917 000 2904", servicePlan: "Studio System + Support", health: "good", notes: "Class discovery, instructor profiles and an accessible enrollment journey." },
    { workspaceId, ownerId: member(4), name: "Balay Coffee Roasters", industry: "Food & beverage", location: "Puerto Princesa, Palawan", status: "active", contactName: "Nico dela Cruz", email: "nico@balay.example", phone: "+63 917 000 3370", servicePlan: "Commerce Essentials", health: "watch", notes: "Wholesale inquiry flow and a faster catalogue for visiting cafés and hotels." },
    { workspaceId, ownerId: member(4), name: "Isla Expeditions", industry: "Travel & tours", location: "Coron, Palawan", status: "active", contactName: "Marielle Ong", email: "marielle@isla.example", phone: "+63 917 000 4816", servicePlan: "Booking Platform + Automation", health: "good", notes: "Private expedition planner with availability operations and automated guest briefs." },
    { workspaceId, ownerId: member(4), name: "Luntian Builders", industry: "Construction", location: "San Vicente, Palawan", status: "active", contactName: "Ramon Garcia", email: "ramon@luntian.example", phone: "+63 917 000 5942", servicePlan: "Project Portfolio", health: "good", notes: "Case-study-led website to make technical capability legible to resort developers." },
    { workspaceId, ownerId: member(4), name: "Coral Logic Advisory", industry: "Professional services", location: "Remote / Palawan", status: "paused", contactName: "Katrina Uy", email: "kat@coralogic.example", phone: "+63 917 000 6155", servicePlan: "Advisory Microsite", health: "watch", notes: "Content paused while the client completes its revised service positioning." },
    { workspaceId, ownerId: member(4), name: "Sirena Dive Club", industry: "Recreation", location: "Port Barton, Palawan", status: "lead", contactName: "Ben Navarro", email: "ben@sirena.example", phone: "+63 917 000 7781", servicePlan: "Discovery phase", health: "new", notes: "Qualified lead seeking a multilingual dive-course catalogue and inquiry automation." },
  ]).returning();
  const c = (index: number) => clientRows[index]?.id ?? null;

  const projectRows = await db.insert(projects).values([
    { workspaceId, clientId: c(0), leadId: member(1), name: "Direct Booking Digital Flagship", code: "NBR-26", description: "A editorial resort website that turns room, place and experience stories into qualified direct bookings.", status: "active", priority: "high", progress: 72, startDate: day(-48), dueDate: day(12), deliverables: ["Responsive website", "Room story CMS", "Booking handoff", "Analytics baseline"], repositoryUrl: "https://github.com/merqato/nacpan-flagship", budgetMinor: 42000000, currency: "PHP" },
    { workspaceId, clientId: c(1), leadId: member(0), name: "Tala Class Discovery System", code: "TLA-14", description: "A calm, mobile-first class catalogue with clear schedules and enrollment pathways.", status: "review", priority: "medium", progress: 88, startDate: day(-40), dueDate: day(5), deliverables: ["Class catalogue", "Instructor profiles", "Enrollment flow"], repositoryUrl: "https://github.com/merqato/tala-studio", budgetMinor: 18500000, currency: "PHP" },
    { workspaceId, clientId: c(2), leadId: member(1), name: "Wholesale Coffee Catalogue", code: "BCR-09", description: "Fast product storytelling and a structured wholesale lead capture workflow.", status: "active", priority: "medium", progress: 46, startDate: day(-21), dueDate: day(26), deliverables: ["Product catalogue", "Wholesale form", "Email notification workflow"], repositoryUrl: "https://github.com/merqato/balay-roasters", budgetMinor: 24000000, currency: "PHP" },
    { workspaceId, clientId: c(3), leadId: member(2), name: "Expedition Guest Automation", code: "ISL-31", description: "Operational guest briefs, availability requests and pre-departure communication.", status: "active", priority: "urgent", progress: 61, startDate: day(-32), dueDate: day(8), deliverables: ["Inquiry triage", "Guest brief generator", "Operations dashboard"], repositoryUrl: "https://github.com/merqato/isla-expeditions", budgetMinor: 36000000, currency: "PHP" },
    { workspaceId, clientId: c(4), leadId: member(1), name: "Built for Island Conditions", code: "LNT-07", description: "A technical project portfolio structured around materials, logistics and build outcomes.", status: "active", priority: "low", progress: 28, startDate: day(-12), dueDate: day(44), deliverables: ["Project case studies", "Capability overview", "Qualification form"], repositoryUrl: "https://github.com/merqato/luntian-builders", budgetMinor: 21000000, currency: "PHP" },
    { workspaceId, clientId: c(5), leadId: member(0), name: "Advisory Positioning Sprint", code: "CLA-03", description: "Messaging and a compact digital presence for a specialist advisory practice.", status: "paused", priority: "low", progress: 35, startDate: day(-60), dueDate: day(60), deliverables: ["Positioning narrative", "Microsite"], budgetMinor: 9500000, currency: "PHP" },
  ]).returning();
  const p = (index: number) => projectRows[index]?.id ?? projectRows[0].id;

  await db.insert(tasks).values([
    { projectId: p(0), assigneeId: member(1), title: "Validate direct-booking handoff on mobile Safari", description: "Test date selection, room context and return paths on physical devices.", status: "in_progress", priority: "urgent", dueDate: day(0), estimateHours: "3.5" },
    { projectId: p(0), assigneeId: member(0), title: "Approve El Nido field-notes editorial sequence", description: "Confirm final story order with the resort team before launch rehearsal.", status: "review", priority: "high", dueDate: day(1), estimateHours: "1.5" },
    { projectId: p(0), assigneeId: member(1), title: "Add room availability empty states", description: "Provide helpful alternatives when selected dates have no matching rooms.", status: "todo", priority: "high", dueDate: day(3), estimateHours: "5" },
    { projectId: p(1), assigneeId: member(1), title: "Resolve schedule filter accessibility findings", description: "Complete keyboard and screen-reader pass for class level filters.", status: "review", priority: "high", dueDate: day(0), estimateHours: "2" },
    { projectId: p(1), assigneeId: member(4), title: "Collect instructor biography sign-off", description: "Close the remaining content approvals before production deployment.", status: "in_progress", priority: "medium", dueDate: day(2), estimateHours: "1" },
    { projectId: p(2), assigneeId: member(1), title: "Model wholesale roast and grind attributes", description: "Keep product options concise while preserving ordering requirements.", status: "in_progress", priority: "medium", dueDate: day(4), estimateHours: "6" },
    { projectId: p(2), assigneeId: member(2), title: "Connect wholesale inquiry notification workflow", description: "Route qualified hotel and café inquiries to the correct internal owner.", status: "todo", priority: "medium", dueDate: day(9), estimateHours: "4" },
    { projectId: p(3), assigneeId: member(2), title: "Test guest brief failure recovery", description: "Verify retries do not duplicate guest messages after provider timeouts.", status: "in_progress", priority: "urgent", dueDate: day(0), estimateHours: "4" },
    { projectId: p(3), assigneeId: member(1), title: "Build expedition availability exception state", description: "Handle weather closures and guide capacity without showing false availability.", status: "todo", priority: "high", dueDate: day(2), estimateHours: "8" },
    { projectId: p(3), assigneeId: member(4), title: "Review pre-departure email copy", description: "Confirm packing, transfer and marine-policy guidance with operations.", status: "done", priority: "medium", dueDate: day(-2), estimateHours: "2", completedAt: new Date() },
    { projectId: p(4), assigneeId: member(0), title: "Structure three flagship case-study interviews", description: "Capture constraints, material choices and measurable project outcomes.", status: "in_progress", priority: "low", dueDate: day(7), estimateHours: "5" },
    { projectId: p(4), assigneeId: member(1), title: "Prototype project location and sector filters", description: "Test a lightweight index for a growing portfolio.", status: "todo", priority: "low", dueDate: day(16), estimateHours: "6" },
    { projectId: p(5), assigneeId: member(0), title: "Hold revised positioning workshop", description: "Waiting for client availability; no delivery work scheduled.", status: "backlog", priority: "low", dueDate: day(30), estimateHours: "2" },
  ]).returning();

  await db.insert(websites).values([
    { workspaceId, clientId: c(0), projectId: p(0), name: "Nacpan Beach Resort", domain: "nacpan.example", productionUrl: "https://nacpan.example", previewUrl: "https://nacpan-preview.example", repositoryUrl: "https://github.com/merqato/nacpan-flagship", hostingProvider: "Vercel", status: "operational", sslExpiry: day(84), lastCheckedAt: new Date(), notes: "Demo inventory record; run a fresh uptime check before relying on status." },
    { workspaceId, clientId: c(1), projectId: p(1), name: "Tala Studio", domain: "tala.example", productionUrl: "https://tala.example", previewUrl: "https://tala-preview.example", repositoryUrl: "https://github.com/merqato/tala-studio", hostingProvider: "Vercel", status: "review", sslExpiry: day(48), lastCheckedAt: new Date(), notes: "Production launch pending content approval." },
    { workspaceId, clientId: c(2), projectId: p(2), name: "Balay Coffee Roasters", domain: "balay.example", productionUrl: "https://balay.example", previewUrl: "https://balay-preview.example", repositoryUrl: "https://github.com/merqato/balay-roasters", hostingProvider: "Coolify / UpCloud", status: "operational", sslExpiry: day(112), lastCheckedAt: new Date() },
    { workspaceId, clientId: c(3), projectId: p(3), name: "Isla Expeditions", domain: "isla.example", productionUrl: "https://isla.example", previewUrl: "https://isla-preview.example", repositoryUrl: "https://github.com/merqato/isla-expeditions", hostingProvider: "Coolify / UpCloud", status: "degraded", sslExpiry: day(21), lastCheckedAt: new Date(), notes: "Demo incident linked to guest brief delivery." },
    { workspaceId, clientId: c(4), projectId: p(4), name: "Luntian Builders", domain: "luntian.example", productionUrl: "https://luntian.example", repositoryUrl: "https://github.com/merqato/luntian-builders", hostingProvider: "Vercel", status: "development", sslExpiry: day(156), lastCheckedAt: new Date() },
    { workspaceId, clientId: c(5), projectId: p(5), name: "Coral Logic", domain: "coralogic.example", productionUrl: "https://coralogic.example", hostingProvider: "Coolify / UpCloud", status: "maintenance", sslExpiry: day(62), lastCheckedAt: new Date() },
  ]).returning();

  const serviceRows = await db.insert(services).values([
    { workspaceId, name: "Distinct Website Design & Development", category: "Website design and development", description: "Strategy, art direction, responsive design, CMS implementation and launch for a distinctive business website.", setupFeeMinor: 18000000, recurringFeeMinor: 0, billingCycle: "one-time", thirdPartyCostMinor: 1200000, internalCostMinor: 8500000, pricingNotes: "Typical range ₱180k–₱480k depending on content model, integrations and editorial scope." },
    { workspaceId, name: "Operational Web Application", category: "Web applications", description: "Purpose-built customer or internal workflows with authentication, data modeling and operational reporting.", setupFeeMinor: 42000000, recurringFeeMinor: 1800000, billingCycle: "monthly", thirdPartyCostMinor: 450000, internalCostMinor: 22000000, pricingNotes: "Scoped after a paid technical discovery; infrastructure and transactional providers billed separately." },
    { workspaceId, name: "Applied AI Agent", category: "AI agents", description: "A bounded AI-assisted workflow with reviewed knowledge sources, human escalation and observable outputs.", setupFeeMinor: 28000000, recurringFeeMinor: 1200000, billingCycle: "monthly", thirdPartyCostMinor: 600000, internalCostMinor: 14000000, pricingNotes: "Model usage is variable and passed through transparently; no unlimited-usage promise." },
    { workspaceId, name: "Business Automation Sprint", category: "Business automation", description: "Map and automate a high-friction operational process with failure handling and staff handover.", setupFeeMinor: 12000000, recurringFeeMinor: 450000, billingCycle: "monthly", thirdPartyCostMinor: 250000, internalCostMinor: 5500000, pricingNotes: "Includes two workflows; third-party automation seats may incur additional charges." },
    { workspaceId, name: "Social Media Management", category: "Social media management", description: "Monthly content planning, channel adaptation, publishing coordination and performance review.", setupFeeMinor: 2500000, recurringFeeMinor: 3800000, billingCycle: "monthly", thirdPartyCostMinor: 300000, internalCostMinor: 2100000, pricingNotes: "Media buying, creators and on-location production quoted separately." },
    { workspaceId, name: "Managed Hosting & Maintenance", category: "Hosting and maintenance", description: "Deployment oversight, dependency updates, backups, uptime review and a monthly maintenance allowance.", setupFeeMinor: 800000, recurringFeeMinor: 650000, billingCycle: "monthly", thirdPartyCostMinor: 180000, internalCostMinor: 2200000, pricingNotes: "Fair-use maintenance up to two hours; VPS and provider charges are itemized." },
    { workspaceId, name: "White-label Software Partnership", category: "White-label software", description: "Agency-branded deployment and support of an existing software system with agreed customization boundaries.", setupFeeMinor: 16000000, recurringFeeMinor: 1500000, billingCycle: "monthly", thirdPartyCostMinor: 400000, internalCostMinor: 7000000, pricingNotes: "License rights and custom feature requests are defined in the partnership agreement." },
    { workspaceId, name: "Recurring Product Support", category: "Recurring support", description: "Prioritized small improvements, content assistance, monitoring and a monthly roadmap review.", setupFeeMinor: 0, recurringFeeMinor: 950000, billingCycle: "monthly", thirdPartyCostMinor: 100000, internalCostMinor: 4200000, pricingNotes: "Four support hours monthly; unused hours do not roll over." },
  ]).returning();

  await db.insert(invoices).values([
    { workspaceId, clientId: c(0), invoiceNumber: "MQ-2026-0142", status: "paid", issueDate: day(-72), dueDate: day(-57), paidAt: new Date(Date.now() - 58 * 86400000), subtotalMinor: 14000000, taxMinor: 0, totalMinor: 14000000, amountPaidMinor: 14000000, source: "demo" },
    { workspaceId, clientId: c(0), invoiceNumber: "MQ-2026-0158", status: "paid", issueDate: day(-39), dueDate: day(-24), paidAt: new Date(Date.now() - 26 * 86400000), subtotalMinor: 14000000, taxMinor: 0, totalMinor: 14000000, amountPaidMinor: 14000000, source: "demo" },
    { workspaceId, clientId: c(0), invoiceNumber: "MQ-2026-0171", status: "sent", issueDate: day(-8), dueDate: day(7), subtotalMinor: 14000000, taxMinor: 0, totalMinor: 14000000, amountPaidMinor: 0, source: "demo" },
    { workspaceId, clientId: c(1), invoiceNumber: "MQ-2026-0163", status: "partially_paid", issueDate: day(-25), dueDate: day(-5), subtotalMinor: 9250000, taxMinor: 0, totalMinor: 9250000, amountPaidMinor: 5000000, source: "demo" },
    { workspaceId, clientId: c(2), invoiceNumber: "MQ-2026-0168", status: "sent", issueDate: day(-14), dueDate: day(1), subtotalMinor: 12000000, taxMinor: 0, totalMinor: 12000000, amountPaidMinor: 0, source: "demo" },
    { workspaceId, clientId: c(3), invoiceNumber: "MQ-2026-0149", status: "overdue", issueDate: day(-62), dueDate: day(-32), subtotalMinor: 12000000, taxMinor: 0, totalMinor: 12000000, amountPaidMinor: 0, source: "demo" },
    { workspaceId, clientId: c(3), invoiceNumber: "MQ-2026-0160", status: "paid", issueDate: day(-31), dueDate: day(-16), paidAt: new Date(Date.now() - 17 * 86400000), subtotalMinor: 12000000, taxMinor: 0, totalMinor: 12000000, amountPaidMinor: 12000000, source: "demo" },
    { workspaceId, clientId: c(3), invoiceNumber: "MQ-2026-0173", status: "draft", issueDate: day(-1), dueDate: day(14), subtotalMinor: 12000000, taxMinor: 0, totalMinor: 12000000, amountPaidMinor: 0, source: "demo" },
    { workspaceId, clientId: c(4), invoiceNumber: "MQ-2026-0169", status: "paid", issueDate: day(-12), dueDate: day(3), paidAt: new Date(Date.now() - 4 * 86400000), subtotalMinor: 10500000, taxMinor: 0, totalMinor: 10500000, amountPaidMinor: 10500000, source: "demo" },
    { workspaceId, clientId: c(5), invoiceNumber: "MQ-2026-0137", status: "overdue", issueDate: day(-94), dueDate: day(-64), subtotalMinor: 4750000, taxMinor: 0, totalMinor: 4750000, amountPaidMinor: 0, source: "demo" },
    { workspaceId, clientId: c(1), invoiceNumber: "MQ-2026-0128", status: "paid", issueDate: day(-110), dueDate: day(-95), paidAt: new Date(Date.now() - 96 * 86400000), subtotalMinor: 9250000, taxMinor: 0, totalMinor: 9250000, amountPaidMinor: 9250000, source: "demo" },
    { workspaceId, clientId: c(2), invoiceNumber: "MQ-2026-0134", status: "paid", issueDate: day(-82), dueDate: day(-67), paidAt: new Date(Date.now() - 67 * 86400000), subtotalMinor: 6000000, taxMinor: 0, totalMinor: 6000000, amountPaidMinor: 6000000, source: "demo" },
  ]).returning();

  await db.insert(subscriptions).values([
    { clientId: c(0), serviceId: serviceRows[5].id, name: "Resort Care & Managed Hosting", status: "active", amountMinor: 950000, billingCycle: "monthly", renewalDate: day(18) },
    { clientId: c(1), serviceId: serviceRows[7].id, name: "Studio Recurring Support", status: "active", amountMinor: 650000, billingCycle: "monthly", renewalDate: day(9) },
    { clientId: c(2), serviceId: serviceRows[5].id, name: "Catalogue Hosting & Maintenance", status: "active", amountMinor: 650000, billingCycle: "monthly", renewalDate: day(27) },
    { clientId: c(3), serviceId: serviceRows[2].id, name: "Guest Automation Operations", status: "active", amountMinor: 1400000, billingCycle: "monthly", renewalDate: day(6) },
    { clientId: c(4), serviceId: serviceRows[7].id, name: "Portfolio Support", status: "pending", amountMinor: 500000, billingCycle: "monthly", renewalDate: day(45) },
  ]);

  const websiteRows = await db.select().from(websites).where(eq(websites.workspaceId, workspaceId));
  await db.insert(incidents).values([
    { workspaceId, websiteId: websiteRows[3]?.id, title: "Guest brief delivery retries exhausted", description: "Demo incident: provider timeout caused two guest briefs to require manual review. Duplicate sending remains blocked.", severity: "high", status: "investigating", startedAt: new Date(Date.now() - 3 * 3600000) },
    { workspaceId, websiteId: websiteRows[1]?.id, title: "Schedule filters fail keyboard review", description: "Demo launch blocker identified during accessibility verification.", severity: "medium", status: "mitigated", startedAt: new Date(Date.now() - 86400000) },
    { workspaceId, websiteId: websiteRows[2]?.id, title: "Completed database snapshot verification", description: "Demo maintenance record: restore checksum matched the source snapshot.", severity: "low", status: "resolved", startedAt: new Date(Date.now() - 5 * 86400000), resolvedAt: new Date(Date.now() - 5 * 86400000 + 1800000) },
  ]);

  await db.insert(automationRuns).values([
    { workspaceId, name: "Nightly database snapshot", source: "Coolify scheduled task", status: "success", externalId: "demo-backup-041", detail: "Demo run: snapshot created and checksum recorded.", startedAt: new Date(Date.now() - 6 * 3600000), finishedAt: new Date(Date.now() - 6 * 3600000 + 94000) },
    { workspaceId, name: "Isla guest brief dispatcher", source: "Internal workflow", status: "failed", externalId: "demo-isla-882", detail: "Demo run: upstream timeout; safe manual retry required.", startedAt: new Date(Date.now() - 3 * 3600000), finishedAt: new Date(Date.now() - 3 * 3600000 + 30000) },
    { workspaceId, name: "Balay wholesale inquiry routing", source: "Internal workflow", status: "success", externalId: "demo-balay-293", detail: "Demo run: inquiry assigned to Client Partnerships.", startedAt: new Date(Date.now() - 9 * 3600000), finishedAt: new Date(Date.now() - 9 * 3600000 + 2400) },
    { workspaceId, name: "SSL renewal review", source: "Operations schedule", status: "success", externalId: "demo-ssl-102", detail: "Demo run: one certificate inside the 30-day review window.", startedAt: new Date(Date.now() - 26 * 3600000), finishedAt: new Date(Date.now() - 26 * 3600000 + 8000) },
    { workspaceId, name: "OpenCode delivery note digest", source: "OpenCode workflow reference", status: "queued", externalId: "demo-opencode-019", detail: "Demo queue entry; no agent execution is claimed.", startedAt: new Date(Date.now() - 600000) },
  ]);

  await db.insert(backgroundJobs).values([
    { workspaceId, type: "integration.sync", status: "queued", payload: { provider: "github", demo: true }, runAt: new Date(Date.now() + 1800000) },
    { workspaceId, type: "backup.verify", status: "success", payload: { demo: true }, attempts: 1, startedAt: new Date(Date.now() - 6 * 3600000), finishedAt: new Date(Date.now() - 6 * 3600000 + 90000) },
    { workspaceId, type: "notification.dispatch", status: "failed", payload: { demo: true }, attempts: 2, error: "Demo failure: no mail transport configured. Configure SMTP before enabling delivery.", finishedAt: new Date(Date.now() - 2 * 3600000) },
  ]);

  if (adminId) {
    await db.insert(notifications).values([
      { userId: adminId, title: "Two invoices need attention", body: "Demo finance data includes overdue balances for Isla Expeditions and Coral Logic Advisory.", type: "warning", link: "/finance" },
      { userId: adminId, title: "Isla launch deadline approaching", body: "Expedition Guest Automation is due in eight days with one urgent failure-recovery task open.", type: "info", link: "/projects" },
      { userId: adminId, title: "Integration setup incomplete", body: "Connect GitHub, Vercel or Coolify to replace empty integration states with verified provider data.", type: "setup", link: "/admin/integrations" },
      { userId: adminId, title: "Local demo workspace ready", body: "All seeded business records are fictional demo data. Disable demo mode for production use.", type: "info", link: "/admin/settings" },
    ]);
    await db.insert(auditEvents).values([
      { workspaceId, userId: adminId, action: "workspace.bootstrapped", entityType: "workspace", entityId: workspaceId, metadata: { demo: true, source: "initial setup" } },
      { workspaceId, userId: adminId, action: "dashboard.seeded", entityType: "dashboard", metadata: { demo: true, name: "Agency Command" } },
      { workspaceId, userId: adminId, action: "integration.review_required", entityType: "security", metadata: { demo: true, detail: "No external credentials configured" } },
    ]);
  }
}

async function seedTools(workspaceId: string, adminId: string | null) {
  const [existing] = await db.select({ value: count() }).from(tools).where(eq(tools.workspaceId, workspaceId));
  if (Number(existing.value) > 0) return;
  const people = await db.select().from(users).where(eq(users.workspaceId, workspaceId));
  const by = (fragment: string) => people.find((person) => person.email.startsWith(fragment)) ?? null;
  const paolo = by("paolo"); const inez = by("inez"); const mika = by("mika");
  const img = (id: string) => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200`;
  const specs = [
    { name: "Guest Brief Dispatcher", slug: "guest-brief-dispatcher", tagline: "Turns expedition bookings into personalised pre-departure briefs over WhatsApp and email.", description: "Watches new bookings, assembles weather, transfer and packing guidance from templates, generates a personalised brief with an LLM, and dispatches it through WhatsApp with safe retries. Built for Isla Expeditions and reusable for any tour operator.", category: "Automation", status: "active", visibility: "client", builder: inez, contributors: ["Inez Villanueva", "Paolo Reyes"], language: "TypeScript", languages: [{ name: "TypeScript", percent: 82 }, { name: "SQL", percent: 11 }, { name: "Shell", percent: 7 }], techStack: ["Next.js 15", "Node.js", "Drizzle ORM", "BullMQ", "OpenRouter", "Twilio WhatsApp API"], ui: "Next.js App Router + Tailwind operator console", database: "PostgreSQL (Neon) + Redis queue", messaging: "Twilio WhatsApp Business API, Resend email, webhook intake", deployment: "Coolify on UpCloud (Docker), preview on Vercel", priceModel: "setup+monthly", priceMinor: 12000000, recurringPriceMinor: 450000, license: "Proprietary — client licence", version: "2.3.1", topics: ["whatsapp", "llm", "tour-operators", "queue"], stars: 14, repo: "https://github.com/merqato/guest-brief-dispatcher", vercel: "https://guest-brief-dispatcher.vercel.app", live: "https://briefs.isla.example", codeTree: `guest-brief-dispatcher/\n├── apps/\n│   ├── console/            # Next.js operator console\n│   │   ├── app/\n│   │   ├── components/\n│   │   └── lib/\n│   └── worker/             # BullMQ dispatch worker\n│       ├── jobs/\n│       │   ├── compose-brief.ts\n│       │   └── send-whatsapp.ts\n│       └── index.ts\n├── packages/\n│   ├── db/                 # Drizzle schema + migrations\n│   ├── prompts/            # Brief templates & guards\n│   └── providers/          # Twilio, Resend, OpenRouter clients\n├── docker-compose.yml\n├── Dockerfile\n└── README.md`, readme: "## Flow\n1. Booking webhook → validated → stored\n2. Worker composes brief (template + LLM, with content guardrails)\n3. Operator approval (optional per client)\n4. WhatsApp dispatch with idempotent retries\n\n## Safety\nDuplicate dispatch is impossible: each booking gets one idempotency key. Failures surface in the Operations queue." },
    { name: "Wholesale Inquiry Router", slug: "wholesale-inquiry-router", tagline: "Qualifies B2B inquiries from website forms and routes them to the right owner with a draft reply.", description: "A small automation that classifies inbound wholesale and partnership inquiries, enriches them with company data, scores intent, and notifies the account owner on Slack/email with a suggested response. Originally built for Balay Coffee Roasters.", category: "Automation", status: "active", visibility: "internal", builder: inez, contributors: ["Inez Villanueva"], language: "TypeScript", languages: [{ name: "TypeScript", percent: 91 }, { name: "YAML", percent: 9 }], techStack: ["Cloudflare Workers", "Hono", "OpenRouter", "Supabase"], ui: "Minimal review inbox (HTMX-style server views)", database: "Supabase Postgres", messaging: "Resend email, Slack webhooks", deployment: "Cloudflare Workers (wrangler), GitHub Actions CI", priceModel: "setup+monthly", priceMinor: 4500000, recurringPriceMinor: 250000, license: "Proprietary", version: "1.4.0", topics: ["forms", "lead-routing", "workers"], stars: 6, repo: "https://github.com/merqato/wholesale-inquiry-router", vercel: null, live: "https://inquiries.balay.example", codeTree: `wholesale-inquiry-router/\n├── src/\n│   ├── index.ts            # Hono app\n│   ├── classify.ts         # LLM intent scoring\n│   ├── enrich.ts\n│   ├── notify/\n│   │   ├── slack.ts\n│   │   └── email.ts\n│   └── views/\n├── supabase/\n│   └── migrations/\n├── wrangler.toml\n└── README.md`, readme: "Deploy with `wrangler deploy`. Secrets: OPENROUTER_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, SLACK_WEBHOOK_URL." },
    { name: "Resort Booking Agent", slug: "resort-booking-agent", tagline: "Conversational availability and booking assistant for small resorts.", description: "An AI agent that answers room, rate and availability questions, holds dates, and hands off to a human for payment. Connects to the resort's booking calendar and falls back gracefully when uncertain.", category: "AI agent", status: "beta", visibility: "client", builder: paolo, contributors: ["Paolo Reyes", "Inez Villanueva", "Mika Santos"], language: "Python", languages: [{ name: "Python", percent: 68 }, { name: "TypeScript", percent: 27 }, { name: "Dockerfile", percent: 5 }], techStack: ["FastAPI", "LangGraph", "Ollama / OpenRouter", "Next.js widget", "PostgreSQL + pgvector"], ui: "Embeddable Next.js chat widget + admin panel", database: "PostgreSQL with pgvector (knowledge base)", messaging: "Web chat, WhatsApp via Twilio, email handoff", deployment: "Coolify (Docker Compose: api + widget + postgres)", priceModel: "setup+monthly", priceMinor: 28000000, recurringPriceMinor: 1200000, license: "Proprietary — client licence", version: "0.9.2", topics: ["ai-agent", "hospitality", "rag", "langgraph"], stars: 21, repo: "https://github.com/merqato/resort-booking-agent", vercel: "https://resort-booking-widget.vercel.app", live: null, codeTree: `resort-booking-agent/\n├── api/\n│   ├── app/\n│   │   ├── agent/\n│   │   │   ├── graph.py        # LangGraph state machine\n│   │   │   ├── tools.py        # availability, hold, handoff\n│   │   │   └── guards.py\n│   │   ├── routers/\n│   │   └── main.py\n│   ├── tests/\n│   └── pyproject.toml\n├── widget/                      # Next.js embeddable chat\n├── knowledge/                   # Resort FAQ & policies\n├── docker-compose.yml\n└── README.md`, readme: "Model-agnostic: runs on Ollama locally for development and OpenRouter in production. Every booking hold expires after 30 minutes unless confirmed by staff." },
    { name: "Uptime & SSL Sentinel", slug: "uptime-ssl-sentinel", tagline: "Checks every managed website, records response time and certificate expiry, and alerts the team.", description: "Lightweight scheduled checker that pings all client websites, reads TLS expiry, and posts alerts to Slack/WhatsApp when something degrades. Feeds the Command Center websites inventory.", category: "Monitoring", status: "active", visibility: "internal", builder: paolo, contributors: ["Paolo Reyes"], language: "Go", languages: [{ name: "Go", percent: 94 }, { name: "Makefile", percent: 6 }], techStack: ["Go 1.22", "SQLite", "cron"], ui: "CLI + JSON endpoint consumed by Command Center", database: "SQLite (embedded)", messaging: "Slack webhook, WhatsApp via Twilio", deployment: "Single static binary in a Coolify scheduled task", priceModel: "internal", priceMinor: 0, recurringPriceMinor: 0, license: "MIT", version: "1.1.0", topics: ["monitoring", "tls", "go"], stars: 9, repo: "https://github.com/merqato/uptime-ssl-sentinel", vercel: null, live: null, codeTree: `uptime-ssl-sentinel/\n├── cmd/sentinel/main.go\n├── internal/\n│   ├── check/\n│   │   ├── http.go\n│   │   └── tls.go\n│   ├── store/sqlite.go\n│   └── notify/\n├── Makefile\n└── README.md`, readme: "`make build && ./sentinel --targets targets.yaml`. Exposes `/status.json` for Command Center's uptime widget." },
    { name: "Social Content Scheduler", slug: "social-content-scheduler", tagline: "Plans, approves and publishes client social posts with AI-assisted captions.", description: "Content calendar with client approval links, caption drafting, image resizing per platform and scheduled publishing through official APIs.", category: "Web app", status: "active", visibility: "client", builder: mika, contributors: ["Mika Santos", "Paolo Reyes"], language: "TypeScript", languages: [{ name: "TypeScript", percent: 88 }, { name: "CSS", percent: 12 }], techStack: ["Next.js", "Supabase", "Meta Graph API", "OpenRouter", "Sharp"], ui: "Next.js + Tailwind, client approval portal", database: "Supabase Postgres + Storage", messaging: "Email approvals (Resend), Meta Graph API publishing", deployment: "Vercel", priceModel: "monthly", priceMinor: 0, recurringPriceMinor: 380000, license: "Proprietary", version: "3.0.4", topics: ["social-media", "scheduler", "nextjs"], stars: 11, repo: "https://github.com/merqato/social-content-scheduler", vercel: "https://social-scheduler.vercel.app", live: "https://social.merqato.example", codeTree: `social-content-scheduler/\n├── app/\n│   ├── (portal)/approve/[token]/\n│   ├── (studio)/calendar/\n│   └── api/publish/\n├── components/\n├── lib/\n│   ├── meta.ts\n│   ├── captions.ts\n│   └── images.ts\n├── supabase/\n└── README.md`, readme: "Publishing uses official Meta Graph API tokens stored server-side. Clients approve via signed, expiring links." },
    { name: "Invoice Reminder Bot", slug: "invoice-reminder-bot", tagline: "Polite, escalating payment reminders synced with InvoiceShelf.", description: "Reads unpaid invoices from InvoiceShelf, sends staged reminders via email/WhatsApp, logs responses, and flags overdue accounts in Command Center finance widgets.", category: "Automation", status: "active", visibility: "internal", builder: inez, contributors: ["Inez Villanueva", "Marco Lim"], language: "TypeScript", languages: [{ name: "TypeScript", percent: 100 }], techStack: ["Node.js", "InvoiceShelf API", "Resend", "Twilio"], ui: "None — runs headless; reports in Command Center", database: "PostgreSQL (shared Command Center DB)", messaging: "Email + WhatsApp", deployment: "Coolify scheduled task (daily 09:00 Asia/Manila)", priceModel: "internal", priceMinor: 0, recurringPriceMinor: 0, license: "Proprietary", version: "1.0.3", topics: ["finance", "reminders", "invoiceshelf"], stars: 4, repo: "https://github.com/merqato/invoice-reminder-bot", vercel: null, live: null, codeTree: `invoice-reminder-bot/\n├── src/\n│   ├── index.ts\n│   ├── invoiceshelf.ts\n│   ├── schedule.ts         # 3 / 7 / 14 day escalation\n│   └── channels/\n├── Dockerfile\n└── README.md`, readme: "Escalation: day 3 friendly, day 7 firm, day 14 account-manager notified. Never sends to disputed invoices." },
  ];
  const images = ["33549424", "33549432", "33549434", "3507996", "36758188", "36758179"];
  for (const [index, spec] of specs.entries()) {
    const [tool] = await db.insert(tools).values({ workspaceId, builtById: spec.builder?.id ?? adminId, name: spec.name, slug: spec.slug, tagline: spec.tagline, description: spec.description, category: spec.category, status: spec.status, visibility: spec.visibility, repositoryUrl: spec.repo, vercelUrl: spec.vercel, liveUrl: spec.live, builtByName: spec.builder?.name ?? "MerQato Administrator", contributors: spec.contributors, language: spec.language, languages: spec.languages, techStack: spec.techStack, ui: spec.ui, database: spec.database, messaging: spec.messaging, deployment: spec.deployment, codeTree: spec.codeTree, readme: spec.readme, priceModel: spec.priceModel, priceMinor: spec.priceMinor, recurringPriceMinor: spec.recurringPriceMinor, license: spec.license, version: spec.version, topics: spec.topics, stars: spec.stars }).returning();
    await db.insert(toolLinks).values([
      ...(spec.repo ? [{ toolId: tool.id, label: "GitHub repository", url: spec.repo, kind: "repository" }] : []),
      ...(spec.vercel ? [{ toolId: tool.id, label: "Vercel deployment", url: spec.vercel, kind: "vercel" }] : []),
      ...(spec.live ? [{ toolId: tool.id, label: "Production", url: spec.live, kind: "production" }] : []),
      { toolId: tool.id, label: "Documentation", url: `https://docs.merqato.example/tools/${spec.slug}`, kind: "docs" },
      { toolId: tool.id, label: "Issue tracker", url: `${spec.repo}/issues`, kind: "issues" },
    ]);
    await db.insert(toolMedia).values([
      { toolId: tool.id, uploadedBy: spec.builder?.id ?? adminId, type: "image", url: img(images[index % images.length]), caption: "Dashboard / operator view (demo stock image)" },
      { toolId: tool.id, uploadedBy: spec.builder?.id ?? adminId, type: "image", url: img(images[(index + 3) % images.length]), caption: "Architecture walkthrough frame (demo stock image)" },
    ]);
    const readmeFile = `# ${spec.name}\n\n${spec.tagline}\n\n${spec.readme}\n\n## Tech stack\n${spec.techStack.map((item) => `- ${item}`).join("\n")}\n\n## Code tree\n\`\`\`\n${spec.codeTree}\n\`\`\`\n`;
    const envFile = `# ${spec.slug} — environment template (demo)\nDATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/${spec.slug.replaceAll("-", "_")}\nOPENROUTER_API_KEY=\nRESEND_API_KEY=\nTWILIO_ACCOUNT_SID=\nTWILIO_AUTH_TOKEN=\n`;
    await db.insert(toolFiles).values([
      { toolId: tool.id, uploadedBy: spec.builder?.id ?? adminId, filename: "README.md", mimeType: "text/markdown", size: Buffer.byteLength(readmeFile), data: Buffer.from(readmeFile).toString("base64"), description: "Project README with setup instructions", version: spec.version },
      { toolId: tool.id, uploadedBy: spec.builder?.id ?? adminId, filename: ".env.example", mimeType: "text/plain", size: Buffer.byteLength(envFile), data: Buffer.from(envFile).toString("base64"), description: "Environment variable template (placeholders only)", version: spec.version },
      { toolId: tool.id, uploadedBy: spec.builder?.id ?? adminId, filename: `${spec.slug}-v${spec.version}-source.zip.txt`, mimeType: "text/plain", size: 96, data: Buffer.from(`Demo placeholder for the packaged source archive of ${spec.name} v${spec.version}. Upload the real .zip here.`).toString("base64"), description: "Packaged source archive (demo placeholder)", version: spec.version },
    ]);
    await db.insert(toolComments).values([
      { toolId: tool.id, userId: spec.builder?.id ?? adminId, body: `Shipped v${spec.version}. Changelog is in the README; deployment notes are in the Documentation link.`, attachments: [], createdAt: hoursAgo(70 + index * 3) },
      { toolId: tool.id, userId: mika?.id ?? adminId, body: "Can we reuse this for the Daluyon Island Hopping pitch? Their inquiry volume looks similar.", attachments: [], createdAt: hoursAgo(30 + index * 2) },
      { toolId: tool.id, userId: adminId, body: "Yes — add it to the proposal as a white-label option with the monthly price listed here.", attachments: [], createdAt: hoursAgo(6 + index) },
    ]);
  }
}

async function seedDashboards(workspaceId: string, adminId: string | null, teamId: string | null) {
  const [existing] = await db.select({ value: count() }).from(dashboards).where(eq(dashboards.workspaceId, workspaceId));
  if (Number(existing.value) > 0) return;
  const specs = [
    { name: "Agency Command", slug: "agency-command", description: "A single operating view of delivery, cash, websites and the systems behind them.", audience: "agency", status: "published", isDefault: true, widgets: ["revenue-overview", "project-progress", "tasks-today", "active-clients", "active-projects", "website-count", "profit-vs-expenses", "expense-breakdown", "upcoming-deadlines", "invoice-status", "recent-activity", "system-health"] },
    { name: "Delivery Pulse", slug: "delivery-pulse", description: "Projects, decisions and launch risk for the digital studio team.", audience: "team", status: "published", isDefault: false, widgets: ["task-board", "project-progress", "team-capacity", "calendar-deadlines", "project-activity", "development-notes"] },
    { name: "Finance Office", slug: "finance-office", description: "Invoiced revenue, received cash, recurring plans and recorded costs.", audience: "function", status: "draft", isDefault: false, widgets: ["revenue-overview", "profit-vs-expenses", "expense-breakdown", "upcoming-renewals", "monthly-revenue", "overdue-payments", "recurring-revenue", "client-subscriptions", "expense-margins", "invoiceshelf-records"] },
  ];
  for (const spec of specs) {
    const [dashboard] = await db.insert(dashboards).values({ workspaceId, ownerId: adminId, teamId: spec.audience === "team" ? teamId : null, name: spec.name, slug: spec.slug, description: spec.description, audience: spec.audience, status: spec.status, isDefault: spec.isDefault, publishedAt: spec.status === "published" ? new Date() : null }).returning();
    let x = 0;
    let y = 0;
    const instances = spec.widgets.map((key, index) => {
      const definition = widgetByKey(key);
      const width = definition?.defaultWidth ?? 4;
      if (x + width > 12) { x = 0; y += 3; }
      const value = { dashboardId: dashboard.id, definitionKey: key, title: definition?.name ?? key, description: definition?.description ?? "", x, y, width, height: definition?.defaultHeight ?? 3, position: index, refreshInterval: definition?.refreshInterval ?? 300, settings: key === "development-notes" ? { markdown: "OpenCode is the primary coding agent. Keep repository-specific implementation decisions here; remote execution is not enabled.", repositoryUrl: "https://github.com/merqato" } : {} };
      x += width;
      return value;
    });
    await db.insert(widgetInstances).values(instances);
    const storedWidgets = await db.select().from(widgetInstances).where(eq(widgetInstances.dashboardId, dashboard.id));
    const versionSnapshot = { dashboard: { name: dashboard.name, description: dashboard.description, audience: dashboard.audience, status: dashboard.status, allowCustomization: dashboard.allowCustomization, teamId: dashboard.teamId }, widgets: storedWidgets.map(({ definitionKey, title, description, x, y, width, height, position, refreshInterval, visible, enabled, userConfigurable, settings }) => ({ definitionKey, title, description, x, y, width, height, position, refreshInterval, visible, enabled, userConfigurable, settings })) };
    await db.insert(dashboardVersions).values({ dashboardId: dashboard.id, version: 1, snapshot: versionSnapshot, note: "Initial administrator configuration", createdBy: adminId });
  }
}

export async function ensureBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap().catch((error) => {
      bootstrapPromise = null;
      throw error;
    });
  }
  return bootstrapPromise;
}
