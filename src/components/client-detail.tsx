"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, LoaderCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type BrandProfile = {
  business_name?: string;
  core_offer?: string;
  target_audience?: string;
  brand_voice?: string[];
  content_pillars?: string[];
  landing_page_angle?: string;
};

type Client = {
  id: string;
  name: string;
  industry: string;
  location: string;
  status: string;
  health: string;
  contactName: string;
  email: string;
  phone: string;
  servicePlan: string;
  notes: string;
  brandProfile: BrandProfile | null;
};

export function ClientDetail({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<Client | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [polling, setPolling] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError("");
      try {
        const response = await fetch(`/api/clients/${clientId}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) throw new Error(body.error || "Could not load client.");
        setClient(body.client);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Load failed.");
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const refreshClient = useCallback(async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}`);
      const body = await response.json();
      if (response.ok) setClient(body.client);
    } catch { /* ignore */ }
  }, [clientId]);

  const [latestJobStatus, setLatestJobStatus] = useState<string>("");

  useEffect(() => {
    if (!client) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/agent/jobs?status=running,status=queued,status=succeeded,status=failed`);
        if (!res.ok) return;
        const body = await res.json();
        const job = body.jobs?.find((j: any) => j.clientId === client.id && j.agent === "marketing");
        if (job) setLatestJobStatus(job.status);
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [client, clientId]);

  async function analyze() {
    setAnalyzing(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/clients/${clientId}/analyze`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not start analysis.");
      setJobId(body.job?.id ?? null);
      setPolling(true);
      setMessage("Brand analysis queued. This may take a minute…");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Analysis failed to start.");
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => {
    if (!polling || !jobId) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/agent/jobs/${jobId}`);
        const body = await response.json();
        const job = body?.job;
        if (!job) return;
        if (job.status === "succeeded") {
          setPolling(false); setJobId(null); setMessage("Brand profile updated."); setError(""); await refreshClient();
        } else if (job.status === "failed" || job.status === "cancelled") {
          setPolling(false); setJobId(null); setError(job.error || "Brand analysis failed.");
        }
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [polling, jobId, refreshClient]);

  if (error && !client) return <div className="card empty-state" style={{ minHeight: 320 }}><strong>{error}</strong><Link className="button" href="/clients" style={{ marginTop: 14 }}><ArrowLeft size={14} />Back to clients</Link></div>;
  if (!client) return <div className="card card-body"><div className="skeleton" style={{ height: 26, width: "40%" }} /><div className="skeleton" /><div className="skeleton" /></div>;

  const profile = client.brandProfile;
  return (
    <>
      <div style={{ marginBottom: 14 }}><Link href="/clients" className="button button-sm button-ghost"><ArrowLeft size={13} />All clients</Link></div>
      <div className="page-heading">
        <div className="page-heading-copy">
          <div className="eyebrow">{client.industry || "Client"} · {client.location || "—"}</div>
          <h1>{client.name}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            <span className={`badge badge-${client.status}`}>{client.status}</span>
            <span className={`badge badge-${client.health}`}>{client.health} health</span>
            {client.servicePlan && <span className="badge">{client.servicePlan}</span>}
          </div>
        </div>
        <div className="heading-actions">
          <button className="button button-primary" onClick={analyze} disabled={analyzing || polling}>
            {analyzing || polling ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {polling ? "Analyzing…" : "Analyze Brand"}
          </button>
        </div>
      </div>
      {message && <div className="form-success" style={{ marginBottom: 14 }}>{message}</div>}
      {latestJobStatus === "running" && <div className="form-success" style={{ marginBottom: 14 }}><LoaderCircle size={13} className="animate-spin" /> Brand analysis in progress...</div>}
      {latestJobStatus === "failed" && <div className="form-error" style={{ marginBottom: 14 }}>Brand analysis failed. <button className="button button-sm" onClick={analyze}>Retry</button></div>}
      {latestJobStatus === "succeeded" && <div className="form-success" style={{ marginBottom: 14 }}>Brand profile updated.</div>}
      {error && latestJobStatus !== "running" && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="card card-body" style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
          <div><strong style={{ color: "var(--text)" }}>Contact</strong><p style={{ color: "var(--muted)", margin: "4px 0 0" }}>{client.contactName || "—"}<br />{client.email || "—"}<br />{client.phone || "—"}</p></div>
          <div><strong style={{ color: "var(--text)" }}>Notes</strong><p style={{ color: "var(--muted)", margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{client.notes || "No notes recorded."}</p></div>
        </div>
      </div>

      {profile ? (
        <div style={{ display: "grid", gap: 16 }}>
          <section className="card">
            <div className="card-header"><Sparkles size={15} /><h2>Brand profile</h2></div>
            <div className="card-body" style={{ display: "grid", gap: 14 }}>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Business name</div><div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{profile.business_name || client.name}</div></div>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Core offer</div><p style={{ margin: "4px 0 0" }}>{profile.core_offer || "—"}</p></div>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Target audience</div><p style={{ margin: "4px 0 0" }}>{profile.target_audience || "—"}</p></div>
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Brand voice</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(profile.brand_voice || []).map((v, i) => <span key={i} className="badge badge-active">{v}</span>)}
                  {!(profile.brand_voice?.length) && <span style={{ color: "var(--muted)" }}>—</span>}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Content pillars</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(profile.content_pillars || []).map((v, i) => <span key={i} className="badge">{v}</span>)}
                  {!(profile.content_pillars?.length) && <span style={{ color: "var(--muted)" }}>—</span>}
                </div>
              </div>
              <div><div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>Landing page angle</div><p style={{ margin: "4px 0 0", fontStyle: "italic" }}>{profile.landing_page_angle || "—"}</p></div>
            </div>
          </section>
        </div>
      ) : (
        <div className="card empty-state" style={{ minHeight: 180 }}>
          <Sparkles size={24} />
          <strong>No brand profile yet</strong>
          <p>Click &quot;Analyze Brand&quot; to have the marketing engine read the client&apos;s website and generate a brand profile.</p>
        </div>
      )}
    </>
  );
}
