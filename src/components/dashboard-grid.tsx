"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Copy, Eye, EyeOff, GripVertical, Library,
  LoaderCircle, LockKeyhole, Pencil, Plus, RotateCcw, Save, Settings2, Trash2, X,
} from "lucide-react";
import type { DashboardDTO, DashboardWidgetDTO } from "@/components/widget-types";
import { WidgetView } from "@/components/widget-view";
import { WIDGET_CATEGORIES, WIDGET_REGISTRY, widgetByKey } from "@/lib/widget-registry";
import { hasPermission, type SessionUser } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type Toast = { message: string; error?: boolean } | null;

function useColumns() {
  const [columns, setColumns] = useState(12);
  useEffect(() => {
    const update = () => setColumns(window.innerWidth <= 620 ? 1 : window.innerWidth <= 900 ? 6 : window.innerWidth <= 1180 ? 8 : 12);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return columns;
}

function recalculate(items: DashboardWidgetDTO[]) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return items.map((item, position) => {
    if (x + item.width > 12) { x = 0; y += rowHeight; rowHeight = 0; }
    const placed = { ...item, x, y, position };
    x += item.width;
    rowHeight = Math.max(rowHeight, item.height);
    return placed;
  });
}

function Modal({ title, description, onClose, children, wide = false }: { title: string; description: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={cn("modal", wide && "modal-lg")} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={16} /></button></div>{children}</section></div>;
}

function WidgetLibrary({ dashboard, onClose, onAdded }: { dashboard: DashboardDTO; onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const filtered = WIDGET_REGISTRY.filter((widget) => (category === "All" || widget.category === category) && `${widget.name} ${widget.description}`.toLowerCase().includes(query.toLowerCase()));
  async function add(key: string) {
    setBusy(key); setError("");
    try {
      const response = await fetch(`/api/dashboards/${dashboard.id}/widgets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definitionKey: key, settings: {} }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not add widget.");
      onAdded();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add widget."); } finally { setBusy(""); }
  }
  return <Modal title="Widget library" description="Modular, permission-aware data contracts. Provider widgets stay empty until connected." onClose={onClose} wide>
    <div className="modal-body"><div className="toolbar"><input className="input" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search widgets and capabilities…" /><select className="input" style={{ width: 220 }} value={category} onChange={(event) => setCategory(event.target.value)}><option>All</option>{WIDGET_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></div>{error && <div className="form-error">{error}</div>}<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10, maxHeight: "52vh", overflow: "auto" }}>{filtered.map((widget) => <div className="card" style={{ padding: 14 }} key={widget.key}><div style={{ display: "flex", gap: 8, alignItems: "center" }}><h3 style={{ margin: 0 }}>{widget.name}</h3><span className="badge" style={{ marginLeft: "auto" }}>{widget.defaultWidth}×{widget.defaultHeight}</span></div><p style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.55, minHeight: 46, margin: "8px 0" }}>{widget.description}</p><div style={{ display: "flex", gap: 5, alignItems: "center" }}><span className="badge">{widget.category}</span>{widget.dependencies.map((dependency) => <span className="badge" key={dependency}>{dependency}</span>)}<button className="button button-sm" style={{ marginLeft: "auto" }} disabled={Boolean(busy)} onClick={() => add(widget.key)}>{busy === widget.key ? <LoaderCircle size={12} className="animate-spin" /> : <Plus size={12} />}Add</button></div></div>)}</div></div>
  </Modal>;
}

function WidgetSettings({ widget, onClose, onSaved }: { widget: DashboardWidgetDTO; onClose: () => void; onSaved: () => void }) {
  const definition = widgetByKey(widget.definitionKey);
  const [title, setTitle] = useState(widget.title);
  const [description, setDescription] = useState(widget.description);
  const [refreshInterval, setRefreshInterval] = useState(widget.refreshInterval);
  const [visible, setVisible] = useState(widget.visible);
  const [enabled, setEnabled] = useState(widget.enabled);
  const [userConfigurable, setUserConfigurable] = useState(widget.userConfigurable);
  const [settings, setSettings] = useState<Record<string, unknown>>(widget.settings);
  const [linksText, setLinksText] = useState(Array.isArray(widget.settings.links) ? (widget.settings.links as { label?: string; url?: string }[]).map((link) => `${link.label || ""} | ${link.url || ""}`).join("\n") : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const schema = definition?.settingsSchema ?? {};
  async function save() {
    setSaving(true); setError("");
    const nextSettings = { ...settings };
    if ("links" in schema) nextSettings.links = linksText.split("\n").map((line) => { const [label, url] = line.split("|").map((part) => part.trim()); return { label, url }; }).filter((link) => link.label && link.url);
    try {
      const response = await fetch(`/api/widget-instances/${widget.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, description, refreshInterval, visible, enabled, userConfigurable, settings: nextSettings }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save settings.");
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save settings."); setSaving(false); }
  }
  return <Modal title={`Configure ${widget.title}`} description={`${definition?.dataContract || "Widget settings"} · v${definition?.version || "1.0.0"}`} onClose={onClose}>
    <div className="modal-body"><div className="form-grid">
      <div className="field field-full"><label>Widget title</label><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></div>
      <div className="field field-full"><label>Description</label><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></div>
      <div className="field"><label>Refresh interval</label><select value={refreshInterval} onChange={(event) => setRefreshInterval(Number(event.target.value))}><option value={30}>Every 30 seconds</option><option value={60}>Every minute</option><option value={300}>Every 5 minutes</option><option value={900}>Every 15 minutes</option><option value={3600}>Every hour</option><option value={86400}>Daily</option></select></div>
      <div className="field"><label>Registry dimensions</label><input value={`${definition?.minWidth || 3}–${definition?.maxWidth || 12} columns · ${definition?.minHeight || 2}–${definition?.maxHeight || 6} rows`} disabled /></div>
      {Object.entries(schema).filter(([key]) => key !== "links").map(([key, raw]) => { const field = raw as { type?: string; required?: boolean }; return <div className={cn("field", field.type === "textarea" && "field-full")} key={key}><label>{key}{field.required ? " *" : ""}</label>{field.type === "textarea" ? <textarea value={typeof settings[key] === "string" ? settings[key] as string : ""} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} /> : <input type={field.type === "url" ? "url" : "text"} value={typeof settings[key] === "string" ? settings[key] as string : ""} placeholder={key === "clientId" ? "Client UUID" : key === "credentialIntegration" ? "Integration key (server-side reference)" : ""} onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.value }))} />}<small>{field.type === "url" ? "Remote hosts must be explicitly allowlisted." : `Mapped settings field · ${field.type || "text"}`}</small></div>; })}
      {"links" in schema && <div className="field field-full"><label>Links</label><textarea value={linksText} onChange={(event) => setLinksText(event.target.value)} placeholder={"Documentation | https://example.com/docs\nStatus | https://status.example.com"} /><small>One per line: Label | HTTPS URL. Invalid protocols are ignored.</small></div>}
      <label className="checkbox"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />Visible on dashboard</label>
      <label className="checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Widget data enabled</label>
      <label className="checkbox field-full"><input type="checkbox" checked={userConfigurable} onChange={(event) => setUserConfigurable(event.target.checked)} />Allow permitted users to personalize this widget</label>
    </div>{error && <div className="form-error">{error}</div>}</div>
    <div className="modal-footer"><button className="button" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={save} disabled={saving || !title.trim()}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save configuration</button></div>
  </Modal>;
}

function SortableWidget({ widget, editing, locked, columns, onConfigure, onDuplicate, onRemove, onChange }: {
  widget: DashboardWidgetDTO;
  editing: boolean;
  locked: boolean;
  columns: number;
  onConfigure: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<DashboardWidgetDTO>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id, disabled: !editing || locked });
  const width = Math.min(columns, widget.width);
  return <div ref={setNodeRef} className="widget-shell" style={{ gridColumn: `span ${width}`, gridRow: `span ${widget.height}`, transform: CSS.Transform.toString(transform), transition, display: !widget.visible && !editing ? "none" : undefined }}>
    <article className={cn("widget-card", isDragging && "dragging", !widget.visible && "hidden-widget", !widget.enabled && "hidden-widget")}>
      <header className="widget-header">
        {editing && <span className="widget-drag" {...attributes} {...listeners} aria-label={`Drag ${widget.title}`}>{locked ? <LockKeyhole size={13} /> : <GripVertical size={14} />}</span>}
        <div className="widget-title"><h3 title={widget.title}>{widget.title}</h3>{widget.description && <p title={widget.description}>{widget.description}</p>}</div>
        {editing && <div className="widget-actions">
          {!locked && <button className="icon-button" onClick={() => onChange({ visible: !widget.visible })} title={widget.visible ? "Hide widget" : "Restore widget"}>{widget.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button>}
          {!locked && <button className="icon-button" onClick={onConfigure} title="Configure widget"><Settings2 size={12} /></button>}
          {!locked && <button className="icon-button" onClick={onDuplicate} title="Duplicate widget"><Copy size={12} /></button>}
          {!locked && <button className="icon-button" onClick={onRemove} title="Remove widget"><Trash2 size={12} /></button>}
        </div>}
      </header>
      <WidgetView widget={widget} reloadKey={widget.enabled ? 1 : 0} />
      {editing && !locked && <div className="resize-controls" aria-label="Grid size controls">
        <button onClick={() => onChange({ width: Math.max(widgetByKey(widget.definitionKey)?.minWidth || 3, widget.width - 1) })} title="Reduce width"><ArrowLeft size={11} /></button><button onClick={() => onChange({ width: Math.min(widgetByKey(widget.definitionKey)?.maxWidth || 12, widget.width + 1, 12) })} title="Increase width"><ArrowRight size={11} /></button>
        <button onClick={() => onChange({ height: Math.max(widgetByKey(widget.definitionKey)?.minHeight || 2, widget.height - 1) })} title="Reduce height"><ArrowUp size={11} /></button><button onClick={() => onChange({ height: Math.min(widgetByKey(widget.definitionKey)?.maxHeight || 6, widget.height + 1) })} title="Increase height"><ArrowDown size={11} /></button>
      </div>}
    </article>
  </div>;
}

export function DashboardGrid({ dashboard, dashboards, initialWidgets, user }: { dashboard: DashboardDTO; dashboards: DashboardDTO[]; initialWidgets: DashboardWidgetDTO[]; user: SessionUser }) {
  const router = useRouter();
  const columns = useColumns();
  const canManage = hasPermission(user, "dashboards.manage");
  const canPersonalize = dashboard.allowCustomization && hasPermission(user, "customize.own");
  const [widgets, setWidgets] = useState(initialWidgets);
  const [editing, setEditing] = useState(false);
  const [library, setLibrary] = useState(false);
  const [configure, setConfigure] = useState<DashboardWidgetDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => { setWidgets(initialWidgets); }, [initialWidgets]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); } }, [toast]);
  const ids = useMemo(() => widgets.map((widget) => widget.id), [widgets]);
  const update = (id: string, patch: Partial<DashboardWidgetDTO>) => setWidgets((current) => recalculate(current.map((widget) => widget.id === id ? { ...widget, ...patch } : widget)));
  const dragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setWidgets((current) => { const oldIndex = current.findIndex((item) => item.id === active.id); const newIndex = current.findIndex((item) => item.id === over.id); return recalculate(arrayMove(current, oldIndex, newIndex)); });
  };
  async function save() {
    setSaving(true);
    const payload = canManage ? widgets : widgets.filter((widget) => widget.userConfigurable);
    try {
      const response = await fetch(`/api/dashboards/${dashboard.id}/layout`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ widgets: payload.map(({ id, x, y, width, height, position, visible, title, settings }) => ({ id, x, y, width, height, position, visible, title, settings })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Layout could not be saved.");
      setToast({ message: body.scope === "personal" ? "Your personal layout is saved." : "Shared dashboard draft saved." });
      setEditing(false); router.refresh();
    } catch (reason) { setToast({ message: reason instanceof Error ? reason.message : "Save failed.", error: true }); } finally { setSaving(false); }
  }
  async function duplicate(widget: DashboardWidgetDTO) {
    const response = await fetch(`/api/widget-instances/${widget.id}`, { method: "POST" });
    const body = await response.json();
    setToast(response.ok ? { message: "Widget duplicated." } : { message: body.error, error: true });
    if (response.ok) router.refresh();
  }
  async function remove(widget: DashboardWidgetDTO) {
    if (!window.confirm(`Remove “${widget.title}” from this dashboard? You can undo this only by adding it again or rolling back a version.`)) return;
    const response = await fetch(`/api/widget-instances/${widget.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    const body = await response.json();
    setToast(response.ok ? { message: "Widget removed from draft." } : { message: body.error, error: true });
    if (response.ok) router.refresh();
  }
  async function resetPersonal() {
    if (!window.confirm("Reset your personal layout to the administrator-defined dashboard?")) return;
    const response = await fetch(`/api/dashboards/${dashboard.id}/layout`, { method: "DELETE" });
    if (response.ok) { setToast({ message: "Personal layout reset." }); router.refresh(); }
  }
  const refresh = () => { router.refresh(); setLibrary(false); setConfigure(null); };

  return <>
    <div className="page-heading"><div className="page-heading-copy"><div className="eyebrow">{dashboard.audience} dashboard · {dashboard.status}</div><h1>{dashboard.name}</h1><p className="page-description">{dashboard.description}</p></div><div className="heading-actions">
      {!editing && (canManage || canPersonalize) && <button className="button" onClick={() => setEditing(true)}><Pencil size={13} />{canManage ? "Edit shared layout" : "Personalize"}</button>}
      {editing && <><button className="button" onClick={() => { setWidgets(initialWidgets); setEditing(false); }}>Cancel</button>{canManage && <button className="button" onClick={() => setLibrary(true)}><Library size={14} />Add widget</button>}<button className="button button-primary" disabled={saving} onClick={save}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}Save {canManage ? "draft" : "layout"}</button></>}
      {!canManage && canPersonalize && !editing && <button className="button button-ghost" onClick={resetPersonal}><RotateCcw size={13} />Reset</button>}
      {canManage && <Link className="button" href={`/admin/dashboards?selected=${dashboard.id}`}><Settings2 size={14} />Builder</Link>}
    </div></div>
    <div className="dashboard-tabs" aria-label="Available dashboards">{dashboards.map((item) => <Link key={item.id} href={`/?dashboard=${item.id}`} className={cn("dashboard-tab", item.id === dashboard.id && "active")}><LayoutDashboardIcon />{item.name}{item.status === "draft" && <span className="badge">Draft</span>}</Link>)}</div>
    {widgets.length ? <div className={cn(editing && "editing")}><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={ids} strategy={rectSortingStrategy}><div className="dashboard-grid">{widgets.map((widget) => <SortableWidget key={widget.id} widget={widget} editing={editing} locked={!canManage && !widget.userConfigurable} columns={columns} onConfigure={() => setConfigure(widget)} onDuplicate={() => duplicate(widget)} onRemove={() => remove(widget)} onChange={(patch) => update(widget.id, patch)} />)}</div></SortableContext></DndContext></div> : <div className="card empty-state" style={{ minHeight: 300 }}><Library size={30} /><strong>This dashboard is empty</strong><p>{canManage ? "Enter the shared layout editor and add the first widget from the registry." : "An administrator has not added any visible widgets yet."}</p>{canManage && <button className="button button-primary" style={{ marginTop: 14 }} onClick={() => { setEditing(true); setLibrary(true); }}><Plus size={14} />Add a widget</button>}</div>}
    {library && <WidgetLibrary dashboard={dashboard} onClose={() => setLibrary(false)} onAdded={refresh} />}
    {configure && <WidgetSettings widget={configure} onClose={() => setConfigure(null)} onSaved={refresh} />}
    {toast && <div className="toast-stack"><div className={cn("toast", toast.error && "error")} role="status">{toast.message}</div></div>}
  </>;
}

function LayoutDashboardIcon() { return <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", opacity: .6 }} />; }
