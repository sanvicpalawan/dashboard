import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Agent bearer authentication.
 *
 * A machine client (the agent worker, a scheduled task) can call the API with
 * `Authorization: Bearer $AGENT_API_KEY` instead of holding a browser session
 * cookie. This is a service credential, not a user: it carries no role and no
 * permissions, so callers decide explicitly what an agent may do rather than
 * inheriting a human's rights.
 */

/**
 * Constant-time comparison of two secrets.
 *
 * timingSafeEqual throws when the buffers differ in length, which would both
 * break on a wrong-length guess and leak the expected length through the
 * thrown error. Hashing both sides to a fixed 32 bytes first removes that:
 * every comparison then runs over equally sized buffers.
 */
function secretEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a, "utf8").digest();
  const right = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(left, right);
}

/** Extract the bearer credential from an Authorization header, or null. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1].trim();
  return token === "" ? null : token;
}

/**
 * True when the request carries the configured agent bearer token.
 *
 * Fails closed: with no AGENT_API_KEY configured no token can match, so agent
 * access stays off rather than accepting an empty credential.
 */
export function validateAgentToken(request: Request): boolean {
  const expected = process.env.AGENT_API_KEY;
  if (typeof expected !== "string" || expected === "") return false;
  const presented = bearerToken(request);
  if (presented === null) return false;
  return secretEquals(presented, expected);
}

/**
 * True when the request carries any agent credential: AGENT_API_KEY above, or
 * the older AGENT_VAULT_SECRET that /api/agent/vault and /api/system have
 * always trusted. The legacy secret is kept only so existing scripts
 * (scripts/get-token.sh, cron jobs) keep working; new callers use AGENT_API_KEY.
 */
export function validateAgentOrVaultToken(request: Request): boolean {
  if (validateAgentToken(request)) return true;
  const expected = process.env.AGENT_VAULT_SECRET;
  if (typeof expected !== "string" || expected === "") return false;
  const presented = bearerToken(request);
  return presented !== null && secretEquals(presented, expected);
}
