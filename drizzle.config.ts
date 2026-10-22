import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js loads .env.local automatically; drizzle-kit does not, so load it here.
config({ path: ".env.local" });
config();

// Neon: schema migrations must run over the direct (non-pooled) endpoint.
// PgBouncer in transaction mode cannot hold the session state Drizzle Kit needs.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
