/**
 * Startup migrations.
 *
 * Migrations run over the direct Neon endpoint (DATABASE_URL_UNPOOLED) because
 * the pooled PgBouncer connection cannot guarantee the session state Drizzle's
 * migrator relies on. The application keeps using the pooled DATABASE_URL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Demo mode is opt-in and meant for development only. Shout when it is enabled on a
  // production build so it can never be mistaken for the real workspace.
  if (process.env.DEMO_MODE === "true" && process.env.NODE_ENV === "production") {
    console.warn("[security] DEMO_MODE=true in a production build: passwordless super-admin sign-in is active and fictional seed records may exist. Set DEMO_MODE=false for real use.");
  }

  if (process.env.AUTO_MIGRATE !== "true") return;

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
