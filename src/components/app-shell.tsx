"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity, Bell, Blocks, BriefcaseBusiness, Building2, ChevronDown, ChevronRight, CircleDollarSign,
  ChevronsLeft, ChevronsRight, Command, ExternalLink, FileText, FolderKanban, Globe2, LayoutDashboard,
  LogOut, Menu, Palette, Search, Settings2, ShieldCheck, Sparkles, Target, Users, Wrench, X,
} from "lucide-react";
import type { SessionUser } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { BRAND_CO_BRAND, BRAND_NAME, BrandLogo } from "@/components/brand-logo";
import { themeVariables, type ThemePreset } from "@/lib/themes";
import { cn, relativeTime } from "@/lib/utils";

type NotificationDTO = { id: string; title: string; body: string; type: string; link: string | null; readAt: string | null; createdAt: string };
type SearchResult = { id: string; type: string; title: string; subtitle: string; url: string };

const nav = [
  { section: "Workspace", items: [
    { href: "/", label: "Overview", icon: LayoutDashboard, permission: "dashboards.view" },
    { href: "/clients", label: "Clients", icon: Building2, permission: "clients.view" },
    { href: "/projects", label: "Projects", icon: FolderKanban, permission: "projects.view" },
    { href: "/websites", label: "Websites", icon: Globe2, permission: "websites.view" },
    { href: "/leads", label: "Lead Generation", icon: Target, permission: "leads.view" },
  ] },
  { section: "Commercial", items: [
    { href: "/services", label: "Services & pricing", icon: BriefcaseBusiness, permission: "services.view" },
    { href: "/finance", label: "Finance", icon: CircleDollarSign, permission: "finance.view" },
  ] },
  { section: "System", items: [
    { href: "/operations", label: "Operations", icon: Activity, permission: "operations.view" },
    { href: "/appearance", label: "Appearance", icon: Palette, permission: "appearance.view" },
    { href: "/admin", label: "Administration", icon: ShieldCheck, permission: "admin.access" },
    { href: "/admin/integrations", label: "Integrations", icon: Blocks, permission: "integrations.view" },
  ] },
  { section: "Automation tools", items: [
    { href: "/tools", label: "Tool catalog", icon: Wrench, permission: "tools.view" },
  ] },
];

function initials(name: string) { return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      try { const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`); if (response.ok) setResults((await response.json()).results); } finally { setLoading(false); }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);
  const go = (url: string) => { onClose(); router.push(url); };
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal" role="dialog" aria-modal="true" aria-label="Command and search">
      <div style={{ position: "relative" }}><Search size={17} style={{ position: "absolute", left: 18, top: 18, color: "var(--muted)" }} /><input ref={inputRef} className="command-input" style={{ paddingLeft: 47 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients, projects, websites or go to…" onKeyDown={(event) => { if (event.key === "Escape") onClose(); if (event.key === "Enter" && results[0]) go(results[0].url); }} /></div>
      <div className="command-results">
        <div className="command-group">{query ? "Search results" : "Quick navigation"}</div>
        {results.map((result) => <button className="command-result" style={{ width: "100%", border: 0, background: "transparent", textAlign: "left", cursor: "pointer" }} key={`${result.type}-${result.id}`} onClick={() => go(result.url)}><Command size={14} /><span><strong>{result.title}</strong><small>{result.type} · {result.subtitle}</small></span><ChevronRight size={13} /></button>)}
        {!loading && !results.length && <div className="empty-state"><Search size={22} /><strong>No matching records</strong><p>Try a client, project code, domain or dashboard name.</p></div>}
        {loading && <div style={{ padding: 12 }}><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>}
      </div>
    </div>
  </div>;
}

export function AppShell({ children, user, notifications, theme, accent, density, mode, branding = {}, navigation = [] }: {
  children: React.ReactNode;
  user: SessionUser;
  branding?: { applicationName?: string; coBrand?: string; brandMark?: string; logoUrl?: string | null; faviconUrl?: string | null };
  navigation?: string[];
  notifications: NotificationDTO[];
  theme: ThemePreset;
  accent?: string | null;
  density?: string | null;
  mode?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [menu, setMenu] = useState<"notifications" | "profile" | "workspace" | null>(null);
  const [items, setItems] = useState(notifications);
  useEffect(() => { setCollapsed(localStorage.getItem("merqato.sidebar") === "collapsed"); }, []);
  useEffect(() => { if (branding.faviconUrl) { let link = document.querySelector<HTMLLinkElement>("link[rel='icon']"); if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); } link.href = branding.faviconUrl; } }, [branding.faviconUrl]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen((value) => !value); }
      if (event.key === "Escape") { setCommandOpen(false); setMenu(null); setMobileOpen(false); }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => { setMobileOpen(false); setMenu(null); }, [pathname]);
  const toggleSidebar = () => setCollapsed((value) => { localStorage.setItem("merqato.sidebar", value ? "expanded" : "collapsed"); return !value; });
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); router.refresh(); };
  const markRead = async (id?: string) => {
    await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setItems((current) => current.map((item) => !id || item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
  };
  const parts = pathname.split("/").filter(Boolean);
  const labels: Record<string, string> = { admin: "Administration", leads: "Lead Generation", tools: "Automation tools", clients: "Clients", projects: "Projects", websites: "Websites", services: "Services & pricing", finance: "Finance", operations: "Operations", appearance: "Appearance", dashboards: "Dashboards", widgets: "Widgets", users: "Users & teams", integrations: "Integrations", settings: "Settings", audit: "Security & audit" };
  const unread = items.filter((item) => !item.readAt).length;

  return <div className="app-theme" data-mode={mode || theme.mode} data-density={density || theme.density} data-card={theme.cardStyle} data-typography={theme.typography} style={themeVariables(theme, accent)}>
    <div className={cn("shell", collapsed && "shell-collapsed", mobileOpen && "shell-mobile-open")} data-sidebar={theme.sidebarStyle}>
      {mobileOpen && <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 35, background: "#0008", border: 0 }} />}
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><BrandLogo src={branding.logoUrl} label={branding.brandMark || "Palawan Collective"} /><div className="brand-copy"><div className="brand-name">{branding.applicationName || BRAND_NAME}</div><div className="brand-sub">{(branding.coBrand || BRAND_CO_BRAND).toUpperCase()}</div></div><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={17} /></button><button className="collapse-button" onClick={toggleSidebar} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}</button></div>
        <nav className="sidebar-nav">
          {nav.map((group) => {
            const visible = group.items.filter((item) => hasPermission(user, item.permission)).sort((a, b) => { const ai = navigation.indexOf(a.label); const bi = navigation.indexOf(b.label); return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi); });
            if (!visible.length) return null;
            return <div key={group.section}><div className="nav-section">{group.section}</div>{visible.map((item) => { const active = item.href === "/" ? pathname === "/" : item.href === "/admin" ? pathname.startsWith("/admin") && !pathname.startsWith("/admin/integrations") : pathname.startsWith(item.href); const Icon = item.icon; return <Link key={item.href} href={item.href} className={cn("nav-link", active && "active")} title={collapsed ? item.label : undefined}><Icon size={16} strokeWidth={1.7} /><span className="nav-label">{item.label}</span>{item.href === "/admin" && <span className="nav-badge">Admin</span>}</Link>; })}</div>;
          })}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" /><div className="sidebar-foot-copy"><strong>System operational</strong>Self-hosted workspace</div></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
          <div className="breadcrumbs"><Link href="/">MerQato</Link>{parts.map((part, index) => <span key={part} style={{ display: "flex", gap: 7 }}><ChevronRight size={11} /><span className={index === parts.length - 1 ? "current" : ""}>{labels[part] || part}</span></span>)}{!parts.length && <><ChevronRight size={11} /><span className="current">Overview</span></>}</div>
          <div className="topbar-actions">
            {user.demoMode && <span className="demo-chip"><Sparkles size={10} />Demo data</span>}
            <button className="command-trigger" onClick={() => setCommandOpen(true)}><Search size={14} /><span>Search workspace</span><kbd>⌘ K</kbd></button>
            <div style={{ position: "relative" }}><button className="icon-button" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} onClick={() => setMenu(menu === "notifications" ? null : "notifications")}><Bell size={16} />{unread > 0 && <span className="notification-dot" />}</button>
              {menu === "notifications" && <div className="dropdown dropdown-wide"><div className="dropdown-header" style={{ display: "flex", alignItems: "center" }}><div><strong>Notifications</strong><p>{unread} unread updates</p></div>{unread > 0 && <button className="button button-sm button-ghost" style={{ marginLeft: "auto" }} onClick={() => markRead()}>Mark all read</button>}</div><div style={{ maxHeight: 390, overflow: "auto" }}>{items.length ? items.slice(0, 12).map((item) => <div className="notification-item" key={item.id} style={{ opacity: item.readAt ? .62 : 1 }}><strong>{item.title}</strong><p>{item.body}</p><time>{relativeTime(item.createdAt)}</time>{item.link && <Link href={item.link} onClick={() => markRead(item.id)} style={{ marginLeft: 10, color: "var(--accent)", fontSize: 9 }}>Open</Link>}</div>) : <div className="empty-state"><Bell size={20} /><strong>All clear</strong><p>No notifications have been recorded.</p></div>}</div></div>}
            </div>
            <div className="workspace-switcher" style={{ position: "relative" }}><button className="profile-button" onClick={() => setMenu(menu === "workspace" ? null : "workspace")} aria-label="Switch workspace"><Blocks size={15} color="var(--muted)" /><ChevronDown size={12} color="var(--muted)" /></button>{menu === "workspace" && <div className="dropdown"><div className="dropdown-header"><strong>{user.workspaceName}</strong><p>{user.workspaceSlug} · Current workspace</p></div><Link className="dropdown-item" href="/admin/settings"><Settings2 size={14} />Workspace settings</Link><div className="dropdown-divider" /><div style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 9 }}>Your account is assigned to one workspace. Workspace assignment is managed by an administrator.</div></div>}</div>
            <div style={{ position: "relative" }}><button className="profile-button" onClick={() => setMenu(menu === "profile" ? null : "profile")} aria-label="User profile"><span className="avatar">{initials(user.name)}</span><ChevronDown size={12} color="var(--muted)" /></button>{menu === "profile" && <div className="dropdown"><div className="dropdown-header"><strong>{user.name}</strong><p>{user.email}<br />{user.roleName}</p></div><Link className="dropdown-item" href="/appearance"><Palette size={14} />Personal appearance</Link>{hasPermission(user, "admin.access") && <Link className="dropdown-item" href="/admin/users"><Users size={14} />Account & sessions</Link>}{hasPermission(user, "audit.view") && <Link className="dropdown-item" href="/admin/audit"><FileText size={14} />Access history</Link>}<div className="dropdown-divider" /><button className="dropdown-item" onClick={logout}><LogOut size={14} />Sign out</button></div>}</div>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
    {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} />}
  </div>;
}
