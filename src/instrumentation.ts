/**
 * Startup migrations.
 *
 * Migrations run over the direct Neon endpoint (DATABASE_URL_UNPOOLED) because
 * the pooled PgBouncer connection cannot guarantee the session state Drizzle's
 * migrator relies on. The application keeps using the pooled DATABASE_URL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.AUTO_MIGRATE !== "true") return;

  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("AUTO_MIGRATE is enabled but neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set.");
  }

  const [{ migrate }, { drizzle }, { Pool }] = await Promise.all([
    import("drizzle-orm/node-postgres/migrator"),
    import("drizzle-orm/node-postgres"),
    import("pg"),
  ]);

  const migrationPool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(migrationPool), { migrationsFolder: "./drizzle" });
  } finally {
    await migrationPool.end();
  }
}
