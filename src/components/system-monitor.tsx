"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Cpu, HardDrive, MemoryStick, RefreshCw, Server } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import type { ContainerRow, SystemSnapshot } from "@/lib/system";

const KIND_LABELS: Record<ContainerRow["kind"], string> = { application: "App", database: "Database", service: "Service" };

function tone(status: string) {
  if (/healthy|running:unknown/.test(status)) return status === "running:unknown" ? "badge-warning" : "badge-healthy";
  if (/starting|restarting|degraded/.test(status)) return "badge-warning";
  if (/exited|stopped|unhealthy|failed/.test(status)) return "badge-error";
  return "";
}

function meter(percent: number) {
  const level = percent >= 90 ? "var(--danger)" : percent >= 75 ? "var(--warning)" : "var(--accent)";
  return <div className="progress-track"><span style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: level }} /></div>;
}

export function SystemMonitor({ initial }: { initial: SystemSnapshot }) {
  const [snapshot, setSnapshot] = useState<SystemSnapshot>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/system", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      setSnapshot(payload);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const { host, containers, coolify } = snapshot;
  const cpu = host.cpu;
  const memory = host.memory;
  const disk = host.disk;
  const running = containers.filter((row) => /running/.test(row.status)).length;

  return <>
    <div className="page-heading">
      <div className="page-heading-copy">
        <div className="eyebrow">Infrastructure</div>
        <h1>Server &amp; workloads</h1>
        <p className="page-description">What is running on the UpCloud VPS right now — CPU, memory, disk and every Coolify application, database and service. Refreshes every 15 seconds.</p>
      </div>
      <div className="heading-actions">
        <button className="button" onClick={load} disabled={loading}><RefreshCw size={13} className={cn(loading && "animate-spin")} />{loading ? "Reading…" : "Refresh"}</button>
      </div>
    </div>

    {error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}

    <div className="stats-grid">
      <div className="card stat-card">
        <div className="label"><Cpu size={11} /> CPU</div>
        <div className="value">{cpu ? `${cpu.percent}%` : "—"}</div>
        <div className="detail">{cpu ? `${cpu.cores} cores · load ${cpu.load.join(" / ")}` : "unavailable"}</div>
        {cpu && meter(cpu.percent)}
      </div>
      <div className="card stat-card">
        <div className="label"><MemoryStick size={11} /> Memory</div>
        <div className="value">{memory ? `${memory.percent}%` : "—"}</div>
        <div className="detail">{memory ? `${memory.usedMb} MB of ${memory.totalMb} MB` : "unavailable"}</div>
        {memory && meter(memory.percent)}
      </div>
      <div className="card stat-card">
        <div className="label"><HardDrive size={11} /> Disk</div>
        <div className="value">{disk ? `${disk.percent}%` : "—"}</div>
        <div className="detail">{disk ? `${disk.usedGb} GB of ${disk.totalGb} GB · ${disk.freeGb} GB free` : "unavailable"}</div>
        {disk && meter(disk.percent)}
      </div>
      <div className="card stat-card">
        <div className="label"><Clock size={11} /> Uptime</div>
        <div className="value">{host.uptimeHours >= 24 ? `${Math.round(host.uptimeHours / 24)}d` : `${host.uptimeHours}h`}</div>
        <div className="detail">{host.hostname} · {host.platform}</div>
      </div>
    </div>

    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-header">
        <div>
          <h2>Workloads · {containers.length}</h2>
          <span className="cell-sub">{running} running{coolify.baseUrl ? ` · via ${coolify.baseUrl.replace(/^https?:\/\//, "")}` : ""}</span>
        </div>
        <div className="actions"><span className="cell-sub">Read {relativeTime(snapshot.generatedAt)}</span></div>
      </div>
      {!coolify.connected ? (
        <div className="card-body"><div className="notice notice-warning" style={{ margin: 0 }}><div><strong>Coolify is not reachable</strong><br />{coolify.error || "No credential"}</div></div></div>
      ) : containers.length ? (
        <div className="module-table-wrap">
          <table className="module-table">
            <thead><tr><th>Workload</th><th>Type</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>
              {containers.map((row) => <tr key={`${row.kind}-${row.id}`}>
                <td>
                  {row.url ? <a className="cell-title" href={row.url} target="_blank" rel="noreferrer">{row.name}</a> : <span className="cell-title">{row.name}</span>}
                  {row.url && <span className="cell-sub">{row.url.replace(/^https?:\/\//, "")}</span>}
                </td>
                <td><span className="badge">{KIND_LABELS[row.kind]}</span></td>
                <td><span className={cn("badge", tone(row.status))}>{row.status}</span></td>
                <td style={{ maxWidth: 320 }}><span className="cell-sub" style={{ whiteSpace: "normal" }}>{row.source || "—"}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state" style={{ minHeight: 180 }}><Server size={25} /><strong>No workloads reported</strong><p>The Coolify token returned an empty inventory.</p></div>
      )}
    </section>

    <p className="page-description" style={{ marginTop: 14 }}>Node {host.nodeVersion}. Host figures are read from the machine itself — Coolify metrics stay disabled, so nothing extra runs on the VPS.</p>
  </>;
}
