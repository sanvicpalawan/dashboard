"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function signIn(body: Record<string, string>) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Sign-in failed.");
      router.replace("/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Sign-in failed.");
      setLoading(false);
    }
  }

  return <div className="login-form">
    <div className="brand"><BrandLogo size={36} /><div className="brand-copy"><div className="brand-name">Palawan Collective</div><div className="brand-sub">COMMAND CENTER</div></div></div>
    <h2>Sign in.</h2>
    <p>Use the administrator account issued for this workspace.</p>
    <form
      onSubmit={(event) => { event.preventDefault(); signIn({ email, password }); }}
      autoComplete="on"
    >
      <div className="field">
        <label htmlFor="login-email">Email</label>
        <input id="login-email" className="input" type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@palawancollective.com" />
      </div>
      <div className="field">
        <label htmlFor="login-password">Password</label>
        <input id="login-password" className="input" type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" />
      </div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="button button-primary" type="submit" disabled={loading}>{loading ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />}{loading ? "Signing in…" : "Sign in"}</button>
    </form>
    <div className="notice" style={{ marginTop: 20 }}><ShieldCheck size={17} /><div><strong>Internal workspace</strong><br />Sessions are stored in the database and expire automatically. Every action is written to the audit log.</div></div>
    {demo && <div className="demo-access"><strong>Demo mode is enabled</strong><br /><button className="button button-sm button-ghost" type="button" onClick={() => signIn({ access: "local-workspace" })} disabled={loading}>Continue as demo administrator</button><br />Demo records and passwordless access are development-only. Set <code>DEMO_MODE=false</code> for real use.</div>}
  </div>;
}
