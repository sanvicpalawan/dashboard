import { z } from "zod";
import type { agentJobs } from "@/db/schema";

/**
 * Shared shape and validation for agent jobs.
 *
 * Kept out of the route handlers because Next.js only allows route files to
 * export HTTP verbs and a small set of config values.
 */

export function publicAgentJob(row: typeof agentJobs.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    instructions: row.instructions,
    directory: row.directory,
    agent: row.agent,
    model: row.model,
    status: row.status,
    approval: row.approval,
    approvalReason: row.approvalReason,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    sessionId: row.sessionId,
    result: row.result,
    output: row.output,
    error: row.error,
    exitCode: row.exitCode,
    worker: row.worker,
    createdByName: row.createdByName,
    projectId: row.projectId,
    runAt: row.runAt.toISOString(),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    heartbeatAt: row.heartbeatAt ? row.heartbeatAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type PublicAgentJob = ReturnType<typeof publicAgentJob>;

export const createJobSchema = z.object({
  title: z.string().trim().min(3).max(160),
  instructions: z.string().trim().min(10).max(20000),
  directory: z.string().trim().min(3).max(400),
  projectId: z.string().uuid().nullable().optional(),
  agent: z.string().trim().max(60).optional(),
  model: z.string().trim().max(120).nullable().optional(),
  priority: z.number().int().min(1).max(9).optional(),
  approval: z.enum(["auto", "required"]).optional(),
  maxAttempts: z.number().int().min(1).max(4).optional(),
});

export const jobActionSchema = z.object({
  action: z.enum(["cancel", "retry", "approve"]),
});

/** How long the dashboard tolerates silence from the worker before calling it offline. */
export const WORKER_HEARTBEAT_TIMEOUT_MS = 45_000;

/** Row in app_settings the worker refreshes on every poll. */
export const WORKER_HEARTBEAT_KEY = "agent.worker.heartbeat";

export type WorkerHeartbeat = {
  worker: string;
  hostname: string;
  pid: number;
  startedAt: string;
  lastSeen: string;
  runningJobId: string | null;
  pollSeconds: number;
  opencodeVersion: string | null;
  model: string | null;
  queuePaused: boolean;
};

export function workerStatus(heartbeat: WorkerHeartbeat | null) {
  if (!heartbeat) return { online: false, reason: "The worker has never reported in." as string | null, heartbeat: null };
  const age = Date.now() - new Date(heartbeat.lastSeen).getTime();
  if (age > WORKER_HEARTBEAT_TIMEOUT_MS) {
    return { online: false, reason: `Last heartbeat ${Math.round(age / 1000)}s ago. The worker is stopped or unreachable.` as string | null, heartbeat };
  }
  return { online: true, reason: null as string | null, heartbeat };
}
