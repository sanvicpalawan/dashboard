import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Neon connection handling.
 *
 * DATABASE_URL is the pooled (-pooler) string and is what the application uses
 * for normal request traffic. Migrations and maintenance tasks must use the
 * direct DATABASE_URL_UNPOOLED string instead -- see drizzle.config.ts and
 * instrumentation.ts.
 */
const databaseUrl = process.env.DATABASE_URL || "postgresql://build:build@localhost:5432/build";

if (!process.env.DATABASE_URL) {
  // During `next build` (Docker build) DATABASE_URL may not be present. Defer the
  // hard failure to request time so route modules can still be collected.
  console.warn("DATABASE_URL is not set; database calls will fail at runtime.");
}

const globalForDb = globalThis as typeof globalThis & {
  __palawanCollectivePool?: Pool;
};

export const pool =
  globalForDb.__palawanCollectivePool ??
  new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // Neon suspends idle computes; keep the pool warm for a short window only.
    allowExitOnIdle: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__palawanCollectivePool = pool;
}

export const db = drizzle(pool);
