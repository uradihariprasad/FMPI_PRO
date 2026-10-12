import { db } from "@/db";
import { ensureSchema } from "@/db/bootstrap";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness. Doubles as the deploy hook that creates the
 * schema on a fresh database (Render health check hits this first).
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureSchema();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
