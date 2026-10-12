import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

/**
 * Managed Postgres (Render, Neon, Supabase, Heroku…) terminates TLS with
 * certificates that are not in the Node trust store, while local/dev and
 * Render-internal connections speak plain TCP. Detect rather than force.
 */
function needsSsl(url: string): boolean {
  if (/\bsslmode=disable\b/.test(url)) return false;
  if (/\bsslmode=(require|verify-ca|verify-full)\b/.test(url)) return true;
  try {
    const host = new URL(url).hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".internal");
    return !local;
  } catch {
    return false;
  }
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: needsSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PGPOOL_MAX ?? 8),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
