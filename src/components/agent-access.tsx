import Link from "next/link";
import { Bot, CircleCheck, CircleMinus, CircleSlash } from "lucide-react";
import { AGENT_ACCESS } from "@/lib/agent-access";

const TONE = {
  direct: { label: "OpenCode can use it", className: "badge badge-success", Icon: CircleCheck },
  dashboard: { label: "Dashboard only", className: "badge badge-warning", Icon: CircleMinus },
  blocked: { label: "Blocked", className: "badge badge-failed", Icon: CircleSlash },
} as const;

/**
 * Honest separation between "connected to the dashboard" and "usable by the agent".
 * Rendered on the integrations page so the two states are never confused.
 */
export function AgentAccessPanel() {
  return <section className="card" style={{ marginTop: 20 }}>
    <div className="card-header">
      <h2>What OpenCode can actually use</h2>
      <Link className="button button-sm" href="/agent" style={{ marginLeft: "auto" }}><Bot size={12} />Agent queue</Link>
    </div>
    <div className="module-table-wrap">
      <table className="module-table">
        <thead><tr><th>Provider</th><th>Agent access</th><th>Permissions</th><th>Detail</th><th>Verified</th></tr></thead>
        <tbody>{AGENT_ACCESS.map((entry) => {
          const tone = TONE[entry.access];
          return <tr key={entry.key}>
            <td><strong style={{ textTransform: "capitalize" }}>{entry.key}</strong></td>
            <td><span className={tone.className}><tone.Icon size={10} />{tone.label}</span></td>
            <td style={{ color: "var(--muted)", fontSize: 10 }}>{entry.permissions}</td>
            <td style={{ color: "var(--muted)", fontSize: 10, maxWidth: 430 }}>{entry.note}</td>
            <td style={{ color: "var(--muted)", fontSize: 10, whiteSpace: "nowrap" }}>{entry.verified || "Not re-checked"}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <div style={{ padding: "10px 16px 14px", color: "var(--muted)", fontSize: 10 }}>
      A green dashboard status means the provider answers the dashboard, not that the agent can act on it. Credentials stay encrypted in Postgres; the agent reads them through scripts/integration-request.mjs and never receives the token text.
    </div>
  </section>;
}
