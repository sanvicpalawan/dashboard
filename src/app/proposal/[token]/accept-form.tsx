"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The signature block. Typing a full name and confirming is the acceptance act; the server
 * records the name, timestamp and IP against the proposal and creates the project + invoice.
 */
export function AcceptForm({ proposalId, token }: { proposalId: string; token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (name.trim().length < 2) {
      setError("Enter the full name of the person accepting.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that you are authorised to accept on behalf of the client.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const response = await fetch(`/api/proposals/${proposalId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, signatureName: name.trim() }),
      });
      const payload = await response.json().catch(() => ({} as { error?: string }));
      if (!response.ok) {
        setError(payload.error || "This proposal could not be accepted. Please contact us.");
        setPending(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <section className="proposal-sign" aria-label="Accept this proposal">
      <h2>Accept this proposal</h2>
      <p>Type your full name to sign. Acceptance creates the project and the invoice for the total above.</p>
      <form onSubmit={submit}>
        <label htmlFor="signature-name">Full name</label>
        <input
          id="signature-name"
          name="signatureName"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Juan Dela Cruz"
          disabled={pending}
        />
        <label className="proposal-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={pending} />
          <span>I am authorised to accept this proposal on behalf of the client.</span>
        </label>
        {error ? <p className="proposal-error" role="alert">{error}</p> : null}
        <button type="submit" disabled={pending}>
          {pending ? "Accepting…" : "Accept proposal"}
        </button>
      </form>
    </section>
  );
}
