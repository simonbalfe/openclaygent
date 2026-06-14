import { and, eq, gt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { type Cache, createCache, type Layer2 } from "./cache.ts";

const cacheTable = pgTable(
  "openclay_cache",
  {
    ns: text("ns").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ns, t.key] })],
);

function warn(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn(`[cache-pg] ${msg.slice(0, 160)}`);
}

function createPgCache(url: string): Layer2 {
  const db = drizzle(url);
  let ready: Promise<void> | undefined;
  const ensure = (): Promise<void> =>
    (ready ??= db
      .execute(sql`
        CREATE TABLE IF NOT EXISTS openclay_cache (
          ns          text        not null,
          key         text        not null,
          value       jsonb       not null,
          expires_at  timestamptz not null,
          primary key (ns, key)
        )`)
      .then(() => undefined));

  return {
    async get(ns, key) {
      try {
        await ensure();
        const rows = await db
          .select({ value: cacheTable.value })
          .from(cacheTable)
          .where(and(eq(cacheTable.ns, ns), eq(cacheTable.key, key), gt(cacheTable.expiresAt, sql`now()`)));
        return rows.length ? rows[0]!.value : undefined;
      } catch (e) {
        warn(e);
        return undefined;
      }
    },
    async set(ns, key, value, ttlMs) {
      try {
        await ensure();
        const seconds = Math.max(1, Math.round(ttlMs / 1000));
        await db
          .insert(cacheTable)
          .values({
            ns,
            key,
            value: sql`${value}::jsonb`,
            expiresAt: sql`now() + (interval '1 second' * ${seconds})`,
          })
          .onConflictDoUpdate({
            target: [cacheTable.ns, cacheTable.key],
            set: { value: sql`excluded.value`, expiresAt: sql`excluded.expires_at` },
          });
      } catch (e) {
        warn(e);
      }
    },
  };
}

export function createCacheFromEnv(): Cache {
  const url = process.env.OPENCLAY_CACHE_URL;
  if (!url) return createCache();
  const ttlSec = Number(process.env.OPENCLAY_CACHE_TTL_SEC);
  return createCache(createPgCache(url), ttlSec > 0 ? ttlSec * 1000 : undefined);
}
