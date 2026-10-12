/**
 * Universe service — the NSE F&O universe (+NIFTY/BANKNIFTY/SENSEX) is
 * sourced dynamically from the Upstox instrument master, cached in
 * Postgres, and re-synced lazily (≥20h staleness) or on demand.
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { ensureSchema, withSchema } from "@/db/bootstrap";
import { instruments, universeSyncs } from "@/db/schema";
import type { InstrumentMeta } from "@/lib/fmpi/types";
import { buildUniverse } from "./upstox";

const STALE_MS = 20 * 3_600_000;
let inflight: Promise<number> | null = null;

export async function syncUniverse(): Promise<number> {
  inflight ??= (async () => {
    try {
      await ensureSchema();
      const uni = await buildUniverse();
      await db.delete(instruments);
      if (uni.instruments.length > 0) {
        await db.insert(instruments).values(
          uni.instruments.map((m) => ({
            instrumentKey: m.instrumentKey, symbol: m.symbol, name: m.name,
            exchange: m.exchange, segment: m.segment,
            futuresKey: m.futuresKey ?? null,
            futuresExpiryTs: m.futuresExpiryTs ?? null,
            lotSize: m.lotSize ?? null,
          })),
        );
      }
      await db.insert(universeSyncs).values({
        id: `sync-${Date.now()}`,
        syncedAt: new Date(),
        count: uni.instruments.length,
        source: "upstox-instrument-master",
      });
      return uni.instruments.length;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function lastSyncAge(): Promise<number> {
  const rows = await db.select().from(universeSyncs).orderBy(desc(universeSyncs.syncedAt)).limit(1);
  if (rows.length === 0) return Infinity;
  return Date.now() - rows[0].syncedAt.getTime();
}

export async function getUniverse(): Promise<InstrumentMeta[]> {
  let rows = await withSchema(() => db.select().from(instruments));
  if (rows.length === 0 || (await lastSyncAge()) > STALE_MS) {
    try {
      await syncUniverse();
      rows = await db.select().from(instruments);
    } catch {
      /* keep serving the last good table */
    }
  }
  return rows
    .map((r) => ({
      instrumentKey: r.instrumentKey, symbol: r.symbol, name: r.name,
      exchange: r.exchange as "NSE" | "BSE", segment: r.segment as "index" | "fno",
      futuresKey: r.futuresKey, futuresExpiryTs: r.futuresExpiryTs, lotSize: r.lotSize,
    }))
    .sort((a, b) => (a.segment !== b.segment ? (a.segment === "index" ? -1 : 1) : a.symbol.localeCompare(b.symbol)));
}

export async function getInstrument(symbolOrKey: string): Promise<InstrumentMeta | null> {
  const uni = await getUniverse();
  const s = symbolOrKey.toUpperCase();
  return uni.find((m) => m.symbol.toUpperCase() === s || m.instrumentKey === symbolOrKey) ?? null;
}

export async function getFuturesMeta(keys: string[]): Promise<Map<string, InstrumentMeta>> {
  const rows = keys.length ? await db.select().from(instruments).where(inArray(instruments.futuresKey, keys)) : [];
  const map = new Map<string, InstrumentMeta>();
  for (const r of rows) {
    if (r.futuresKey) map.set(r.futuresKey, {
      instrumentKey: r.instrumentKey, symbol: r.symbol, name: r.name,
      exchange: r.exchange as "NSE" | "BSE", segment: r.segment as "index" | "fno",
      futuresKey: r.futuresKey, futuresExpiryTs: r.futuresExpiryTs, lotSize: r.lotSize,
    });
  }
  return map;
}
