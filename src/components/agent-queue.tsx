"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Check, ChevronDown, ChevronRight, CircleAlert, LoaderCircle, Play, RefreshCw,
  RotateCcw, Square, Send, Terminal, Wifi, WifiOff,
} from "lucide-react";
import { hasPermission, type SessionUser } from "@/lib/permissions";
import { cn, relativeTime } from "@/lib/utils";
import type { PublicAgentJob } from "@/lib/agent-jobs";

type WorkerState = { online: boolean; reason: string | null; heartbeat: { worker: string; hostname: string; pid: number; startedAt: string; lastSeen: string; runningJobId: string | null; pollSeconds: number; opencodeVersion: string | null; model: string | null } | null };
type StatusPayload = { worker: WorkerState; counts: Record<string, number>; active: number; allowedRoots: string[] };

const STATUS_TONE: Record<string, string> = {
  queued: "queued",
  awaiting_approval: "awaiting",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
};

function tone(status: string) {
  return `badge agent-badge agent-badge-${STATUS_TONE[status] || "queued"}`;
}

function label(status: string) {
  return status.replace(/_/g, " ");
}

export function AgentQueue({ user, initialJobs, initialStatus }: { user: SessionUser; initialJobs: PublicAgentJob[]; initialStatus: StatusPayload }) {
  const [jobs, setJobs] = useState<PublicAgentJob[]>(initialJobs);
  const [status, setStatus] = useState<StatusPayload>(initialStatus);
  const [open, setOpen] = useState<string | null>(initialJobs.find((job) => job.status === "running")?.id || null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [directory, setDirectory] = useState(initialStatus.allowedRoots[0] || "");
  const [model, setModel] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [showForm, setShowForm] = useState(initialJobs.length === 0);

  const canRun = hasPermission(user, "agent.run");
  const canApprove = hasPermission(user, "agent.manage");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [jobsResponse, statusResponse] = await Promise.all([fetch("/api/agent/jobs?limit=60"), fetch("/api/agent/status")]);
      if (jobsResponse.ok) {
        const body = await jobsResponse.json();
        setJobs(body.jobs);
        if (Array.isArray(body.allowedRoots)) setStatus((current) => ({ ...current, allowedRoots: body.allowedRoots }));
      }
      if (statusResponse.ok) setStatus(await statusResponse.json());
    } catch {
      // A transient network error must not clear the queue from the screen.
    }
  }, []);

  useEffect(() => {
    const active = jobs.some((job) => job.status === "running" || job.status === "queued");
    const period = active ? 2500 : 10000;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(load, period);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [jobs, load]);

  const counts = useMemo(() => status.counts || {}, [status]);

  async function create() {
    setBusy("create");
    setMessage(null);
    try {
      const response = await fetch("/api/agent/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, instructions, directory, model: model || null, approval: requiresApproval ? "required" : "auto" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create the job.");
      setMessage({ text: body.job.status === "awaiting_approval" ? "Job saved and held for approval. Review it, then approve to run." : "Job queued. The worker will pick it up on its next poll." });
      setTitle(""); setInstructions(""); setRequiresApproval(false);
      setOpen(body.job.id);
      await load();
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : "Could not create the job.", error: true });
    } finally {
      setBusy("");
    }
  }

  async function act(job: PublicAgentJob, action: "cancel" | "retry" | "approve") {
    if (action === "cancel" && !window.confirm(`Cancel "${job.title}"? A running job is stopped by the worker within a few seconds.`)) return;
    setBusy(`${job.id}-${action}`);
    setMessage(null);
    try {
      const response = await fetch(`/api/agent/jobs/${job.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Action failed.");
      setJobs((current) => current.map((existing) => existing.id === body.job.id ? body.job : existing));
      setMessage({ text: action === "approve" ? "Approved. The worker will run it on its next poll." : action === "retry" ? "Returned to the queue." : "Cancelled." });
      await load();
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : "Action failed.", error: true });
    } finally {
      setBusy("");
    }
  }

  return <>
    <div className="page-heading">
      <div className="page-heading-copy">
        <div className="eyebrow">Delegate work to OpenCode</div>
        <h1>Agent queue</h1>
        <p className="page-description">Write the task, choose the repository folder and the local worker runs it with OpenCode, then records the log, the result and any blocker here.</p>
      </div>
      <div className="heading-actions">
        <button className="button" onClick={load} disabled={loading}><RefreshCw size={13} />Refresh</button>
        {canRun && <button className="button button-primary" onClick={() => setShowForm((value) => !value)}><Send size={13} />New job</button>}
      </div>
    </div>

    <div className="agent-runtime">
      <div className={cn("agent-runtime-card", status.worker.online ? "is-online" : "is-offline")}>
        {status.worker.online ? <Wifi size={15} /> : <WifiOff size={15} />}
        <div>
          <strong>{status.worker.online ? "Worker online" : "Worker offline"}</strong>
          <small>
            {status.worker.heartbeat
              ? `${status.worker.heartbeat.worker} - last seen ${relativeTime(status.worker.heartbeat.lastSeen)}`
              : "Start it with C:\\dev\\merqato\\tools\\start-agent-worker.cmd"}
          </small>
        </div>
      </div>
      <div className="agent-runtime-card">
        <Bot size={15} />
        <div>
          <strong>OpenCode {status.worker.heartbeat?.opencodeVersion || "unknown"}</strong>
          <small>{status.worker.heartbeat ? `Polls every ${status.worker.heartbeat.pollSeconds}s, one job at a time${status.worker.heartbeat.model ? `, model ${status.worker.heartbeat.model}` : ""}` : "Version is reported by the worker heartbeat"}</small>
        </div>
      </div>
      {(["queued", "running", "awaiting_approval", "failed"] as const).map((key) => (
        <div className="agent-runtime-card agent-count" key={key}>
          <strong>{counts[key] || 0}</strong>
          <small>{label(key)}</small>
        </div>
      ))}
    </div>

    {!status.worker.online && <div className="notice notice-warning"><CircleAlert size={16} /><div><strong>Nothing will execute while the worker is stopped.</strong> The queue survives restarts because it lives in Postgres. Start the worker on this laptop, or leave the laptop on with the startup entry enabled.</div></div>}

    {message && <div className={message.error ? "form-error" : "form-success"} style={{ marginBottom: 14 }}>{message.text}</div>}

    {showForm && canRun && <section className="card agent-form">
      <div className="card-header"><h2>New agent job</h2><span className="badge" style={{ marginLeft: "auto" }}>Runs on this machine</span></div>
      <div className="form-grid">
        <div className="field field-full"><label>Task title</label><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Fix the broken checkout redirect on sanvicph" maxLength={160} /></div>
        <div className="field field-full"><label>Working directory</label>
          <input list="agent-roots" value={directory} onChange={(event) => setDirectory(event.target.value)} placeholder="C:\\dev\\sanvicph" />
          <datalist id="agent-roots">{status.allowedRoots.map((root) => <option key={root} value={root} />)}</datalist>
          <small>Must be inside the allowlist: {status.allowedRoots.join(", ")}. The job runs with that folder as its working directory.</small>
        </div>
        <div className="field"><label>Model</label>
          <select value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="">Standard (OpenCode default)</option>
            <option value="ollama/qwen2.5-coder:3b">Quick (local Qwen 3B, free)</option>
          </select>
          <small>Quick keeps the work on this machine and costs nothing. Use Standard for complex changes.</small>
        </div>
        <div className="field"><label>Approval</label>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, marginTop: 8 }}>
            <input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} />
            Hold this job until I approve it
          </label>
          <small>Use for production deploys, DNS or anything billable. Instructions matching a guard rule are always held.</small>
        </div>
        <div className="field field-full"><label>Instructions</label>
          <textarea rows={7} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Describe the outcome, the repository, how to verify the work and what must not change. The agent has no memory of this conversation, so include the context it needs." maxLength={20000} />
          <small>{instructions.length} / 20000 characters. Be explicit about tests to run and when to stop and report a blocker.</small>
        </div>
      </div>
      <div className="modal-footer" style={{ padding: "0 16px 14px" }}>
        <button className="button" onClick={() => { setShowForm(false); setMessage(null); }}>Close</button>
        <button className="button button-primary" onClick={create} disabled={busy === "create" || title.trim().length < 3 || instructions.trim().length < 10 || !directory.trim()}>
          {busy === "create" ? <LoaderCircle size={14} className="animate-spin" /> : <Play size={14} />}Queue job
        </button>
      </div>
    </section>}

    <section className="card" style={{ marginTop: 18 }}>
      <div className="card-header"><h2>Jobs</h2><span className="badge" style={{ marginLeft: "auto" }}>{jobs.length} shown - {status.active} active</span></div>
      {jobs.length === 0 ? <div className="empty-state"><Bot size={23} /><strong>No agent jobs yet</strong><p>Queue one above. The worker runs it, records the log and marks the result.</p></div> : <div className="module-table-wrap">
        <table className="module-table agent-table">
          <thead><tr><th /><th>Job</th><th>Status</th><th>Folder</th><th>Attempts</th><th>Updated</th><th /></tr></thead>
          <tbody>{jobs.map((job) => <Fragment key={job.id}>
            <tr className={open === job.id ? "is-open" : undefined}>
              <td style={{ width: 26 }}><button className="icon-button" onClick={() => setOpen(open === job.id ? null : job.id)} aria-label="Toggle detail">{open === job.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
              <td><strong>{job.title}</strong><div className="agent-sub">{job.createdByName || "Unknown"} - created {relativeTime(job.createdAt)}{job.model ? ` - ${job.model}` : ""}</div></td>
              <td><span className={tone(job.status)}>{label(job.status)}</span></td>
              <td className="agent-path">{job.directory}</td>
              <td>{job.attempts}/{job.maxAttempts}</td>
              <td>{job.finishedAt ? relativeTime(job.finishedAt) : job.startedAt ? `started ${relativeTime(job.startedAt)}` : relativeTime(job.createdAt)}</td>
              <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>{job.status === "awaiting_approval" && canApprove && <button className="button button-sm button-primary" disabled={Boolean(busy)} onClick={() => act(job, "approve")}>{busy === `${job.id}-approve` ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}Approve</button>}
                {(job.status === "queued" || job.status === "running") && canRun && <button className="button button-sm" disabled={Boolean(busy)} onClick={() => act(job, "cancel")}>{busy === `${job.id}-cancel` ? <LoaderCircle size={12} className="animate-spin" /> : <Square size={12} />}Cancel</button>}
                {(job.status === "failed" || job.status === "cancelled" || job.status === "succeeded") && canRun && <button className="button button-sm" disabled={Boolean(busy)} onClick={() => act(job, "retry")}>{busy === `${job.id}-retry` ? <LoaderCircle size={12} className="animate-spin" /> : <RotateCcw size={12} />}Retry</button>}
              </td>
            </tr>
            {open === job.id && <tr className="agent-detail-row">
              <td />
              <td colSpan={6}>
                <div className="agent-detail">
                  <div>
                    <h4>Instructions</h4>
                    <pre className="agent-pre agent-pre-short">{job.instructions}</pre>
                  </div>
                  {job.status === "awaiting_approval" && <div className="notice notice-warning" style={{ margin: 0 }}><CircleAlert size={15} /><div><strong>Held for approval.</strong> {job.approvalReason || "Approval was requested when the job was created."}</div></div>}
                  {job.result && <div><h4>Result reported by the agent</h4><pre className="agent-pre">{job.result}</pre></div>}
                  {job.error && <div><h4 className="agent-error-title">Blocker</h4><pre className="agent-pre agent-pre-error">{job.error}</pre></div>}
                  <div>
                    <h4><Terminal size={12} /> Execution log {job.status === "running" && <span className="agent-live">live</span>}</h4>
                    <pre className="agent-pre agent-log">{job.output || "No output yet."}</pre>
                  </div>
                  <div className="agent-meta">
                    <span>Job {job.id.slice(0, 8)}</span>
                    <span>Exit code {job.exitCode === null ? "not reported" : job.exitCode}</span>
                    <span>OpenCode session {job.sessionId || "not reported"}</span>
                    <span>Worker {job.worker || "unclaimed"}</span>
                  </div>
                </div>
              </td>
            </tr>}
          </Fragment>)}</tbody>
        </table>
      </div>}
    </section>
  </>;
}
