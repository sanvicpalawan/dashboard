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
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required. Run `neon env pull` (or copy .env.example to .env.local) to load the Neon connection string.",
  );
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
