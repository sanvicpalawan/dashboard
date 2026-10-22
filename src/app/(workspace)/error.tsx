"use client";

import { AlertCircle, RotateCcw } from "lucide-react";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="card empty-state" style={{ minHeight: 420 }}><AlertCircle size={30} /><strong>This workspace view could not be loaded</strong><p>No changes were made. Retry the request; if it continues, inspect application and database health in administration.</p><button className="button" style={{ marginTop: 14 }} onClick={reset}><RotateCcw size={14} />Try again</button></div>;
}
