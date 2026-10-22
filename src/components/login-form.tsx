"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function enterWorkspace() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access: "local-workspace" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Workspace access is unavailable.");
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Workspace access is unavailable.");
      setLoading(false);
    }
  }

  return <div className="login-form">
    <div className="brand"><BrandLogo size={36} /><div className="brand-copy"><div className="brand-name">Palawan Collective</div><div className="brand-sub">COMMAND CENTER</div></div></div>
    <h2>Enter the workspace.</h2>
    <p>Email authentication is temporarily removed while we build.</p>
    <div className="notice" style={{ marginBottom: 20 }}><ShieldCheck size={17} /><div><strong>Local development access</strong><br />Continue with the demo administrator account. A normal database-backed session is still created, so layouts, roles and permissions continue to work.</div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="button button-primary" type="button" onClick={enterWorkspace} disabled={loading || !demo}>{loading ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />}{loading ? "Opening workspace…" : "Continue as administrator"}</button>
    {!demo && <div className="demo-access"><strong>Authentication is not configured</strong><br />Passwordless access is only available in demo/development mode. An identity provider or replacement authentication flow can be configured later.</div>}
    {demo && <div className="demo-access"><strong>Demo workspace</strong><br />No email or password required. External integrations remain disconnected until real credentials are configured.</div>}
  </div>;
}
