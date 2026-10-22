import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  try {
    const [algorithm, salt, expected] = stored.split(":");
    if (algorithm !== "scrypt" || !salt || !expected) return false;
    const actual = scryptSync(password, salt, 64);
    const expectedBuffer = Buffer.from(expected, "hex");
    return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function encryptionKey() {
  const source = process.env.CREDENTIAL_ENCRYPTION_KEY || process.env.AUTH_SECRET || (process.env.DEMO_MODE !== "false" ? "local-demo-only-not-for-production" : "");
  if (!source || source === "local-demo-only-not-for-production") {
    if (process.env.NODE_ENV === "production") throw new Error("CREDENTIAL_ENCRYPTION_KEY must be set before storing integration credentials. Demo fallback keys are never used in production.");
  }
  if (!source) throw new Error("CREDENTIAL_ENCRYPTION_KEY is required before storing integration credentials.");
  return createHash("sha256").update(source).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string | null) {
  if (!value) return null;
  const [version, ivValue, tagValue, payload] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !payload) throw new Error("Stored credential format is invalid. Reconnect this integration.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}

export function secretHint(value: string) {
  if (!value) return null;
  return `••••${value.slice(-4)}`;
}

const attempts = new Map<string, { count: number; resetAt: number }>();
export function checkRateLimit(key: string, limit = 10, windowMs = 60_000) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }
  current.count += 1;
  return { allowed: current.count <= limit, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
}

export function safeExternalUrl(value: string) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error("Only HTTP(S) destinations are supported.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname === "metadata") {
    throw new Error("This destination is not publicly routable. Add an explicit private-endpoint allowlist in workspace settings.");
  }
  if (/^(127\.|10\.|169\.254\.|192\.168\.|100\.100\.100\.200$)/.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
    throw new Error("Private network destinations require an explicit allowlist entry.");
  }
  return url;
}
