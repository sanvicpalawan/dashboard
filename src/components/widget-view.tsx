"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, Database, Inbox, LoaderCircle, PlugZap, RefreshCw } from "lucide-react";
import type { DashboardWidgetDTO, WidgetData, WidgetItem } from "@/components/widget-types";
import { relativeTime } from "@/lib/utils";

function ItemRow({ item }: { item: WidgetItem }) {
  return <div className="widget-item">
    <div className="widget-item-main">
      {item.url ? <a className="widget-item-title" href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <span className="widget-item-title" title={item.title}>{item.title}</span>}
      {item.subtitle && <span className="widget-item-sub" title={item.subtitle}>{item.subtitle}</span>}
      {item.meta && <span className="widget-item-sub">{item.meta}</span>}
    </div>
    {item.progress !== undefined && <div className="progress-track" aria-label={`${item.progress}% complete`}><span style={{ width: `${Math.max(0, Math.min(100, item.progress))}%` }} /></div>}
    {item.value && <span className="widget-item-meta" style={{ color: "var(--text)" }}>{item.value}</span>}
    {item.status && <span className={`badge badge-${item.status.toLowerCase().replaceAll(" ", "-")}`}>{item.status}</span>}
  </div>;
}

function StateView({ data }: { data: WidgetData }) {
  const disconnected = data.state === "disconnected";
  const error = data.state === "error";
  const Icon = disconnected ? PlugZap : error ? AlertCircle : Inbox;
  return <div className="empty-state"><Icon size={22} /><strong>{disconnected ? "Integration not connected" : error ? "Unable to load this view" : "Nothing to show yet"}</strong><p>{data.message || "Records will appear here when they are available."}</p></div>;
}

export function WidgetContent({ data }: { data: WidgetData }) {
  if (data.kind === "state") return <StateView data={data} />;
  if (data.kind === "metric") return <div><div className="metric-value">{data.value}</div><div className="metric-label">{data.label}</div>{data.secondary && <div className="metric-secondary">{data.secondary}</div>}</div>;
  if (data.kind === "list" || data.kind === "health" || data.kind === "links") {
    if (data.kind === "links") return <div className="link-grid">{data.items?.map((item) => <a className="link-tile" key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><ArrowUpRight size={11} style={{ marginLeft: "auto", flex: "0 0 auto" }} /></a>)}</div>;
    return <div className="widget-list">{data.items?.map((item) => <ItemRow key={item.id} item={item} />)}</div>;
  }
  if (data.kind === "table") return <div className="module-table-wrap"><table className="data-table"><thead><tr>{data.columns?.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{data.rows?.map((row, index) => <tr key={index}>{data.columns?.map((column) => <td key={column.key}>{row[column.key]}</td>)}</tr>)}</tbody></table>{!data.rows?.length && <div className="empty-state"><Inbox size={20} /><strong>No records</strong></div>}</div>;
  if (data.kind === "board") return <div className="board">{data.groups?.map((group) => <div className="board-lane" key={group.title}><div className="board-lane-title">{group.title} · {group.items.length}</div>{group.items.map((item) => <div className="board-card" key={item.id}><strong>{item.title}</strong><small>{item.subtitle}</small><div style={{ display: "flex", marginTop: 6, gap: 5, alignItems: "center" }}>{item.status && <span className={`badge badge-${item.status}`}>{item.status}</span>}<small style={{ marginLeft: "auto" }}>{item.meta}</small></div></div>)}</div>)}</div>;
  if (data.kind === "series") {
    const maximum = Math.max(1, ...(data.series?.flatMap((item) => [item.value, item.secondary ?? 0]) ?? [1]));
    return <div><div className="metric-secondary">{data.label}</div><div className="bar-chart">{data.series?.map((item) => <div className="bar-group" key={item.label} title={`${item.label}: ${item.value.toLocaleString()} / ${(item.secondary ?? 0).toLocaleString()}`}><div className="bar-pair"><span className="bar" style={{ height: `${Math.max(2, item.value / maximum * 100)}%` }} /><span className="bar secondary" style={{ height: `${Math.max(2, (item.secondary ?? 0) / maximum * 100)}%` }} /></div><span className="bar-label">{item.label}</span></div>)}</div></div>;
  }
  if (data.kind === "notes") return <div>{data.label && <div className="metric-label" style={{ marginBottom: 9 }}>{data.label}</div>}<div className="notes-content">{data.text}</div>{data.items && data.items.length > 0 && <div className="link-grid" style={{ marginTop: 12 }}>{data.items.map((item) => <a className="link-tile" key={item.id} href={item.url} target="_blank" rel="noreferrer"><span>{item.title}</span><ArrowUpRight size={11} /></a>)}</div>}</div>;
  if (data.kind === "image" && data.imageUrl) return <img className="widget-image" src={data.imageUrl} alt={data.label || "Configured widget image"} />;
  if (data.kind === "embed" && data.embedUrl) return <iframe className="widget-embed" src={data.embedUrl} title={data.label || "Calendar"} sandbox="allow-scripts allow-same-origin" referrerPolicy="no-referrer" />;
  return <StateView data={{ kind: "state", state: "empty", message: "No displayable content was returned." }} />;
}

export function WidgetView({ widget, reloadKey = 0 }: { widget: DashboardWidgetDTO; reloadKey?: number }) {
  const [data, setData] = useState<WidgetData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const load = useCallback(async (quiet = false) => {
    if (!widget.enabled) { setData({ kind: "state", state: "empty", message: "This widget is disabled by an administrator. Re-enable it in widget settings." }); setLoading(false); return; }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/widgets/data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: widget.definitionKey, settings: widget.settings }), signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Widget request failed.");
      setData(body.data);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Widget request failed.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [widget.definitionKey, widget.settings]);
  useEffect(() => { load(); return () => requestRef.current?.abort(); }, [load, reloadKey]);
  useEffect(() => {
    if (widget.refreshInterval < 30) return;
    const timer = setInterval(() => load(true), widget.refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [load, widget.refreshInterval]);
  const display = error ? { kind: "state", state: "error", message: error } as WidgetData : data;
  return <>
    <div className="widget-body">
      {loading && !display ? <div aria-label="Loading widget"><div className="skeleton" style={{ width: "45%", height: 22 }} /><div className="skeleton" /><div className="skeleton" style={{ width: "80%" }} /><div className="skeleton" style={{ width: "65%" }} /></div> : display ? <WidgetContent data={display} /> : null}
      {display?.message && display.kind !== "state" && <div className={display.stale ? "form-error" : "form-success"}>{display.message}</div>}
    </div>
    <div className="widget-footer">
      {display?.demo ? <span className="demo-data-label">Demo records</span> : <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Database size={9} />{display?.source || "Waiting for data"}</span>}
      <span className="freshness">{display?.stale ? "Cached / stale · " : ""}{display?.fetchedAt ? relativeTime(display.fetchedAt) : ""}</span>
      <button className="icon-button" style={{ width: 18, height: 18 }} onClick={() => load()} aria-label={`Refresh ${widget.title}`}><RefreshCw size={10} className={loading ? "animate-spin" : ""} /></button>
    </div>
  </>;
}
