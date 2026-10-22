export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AUTO_MIGRATE === "true") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { db } = await import("@/db");
    await migrate(db, { migrationsFolder: "./drizzle" });
  }
}
