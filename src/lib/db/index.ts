import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type AppDb = NeonHttpDatabase<typeof schema>;

let cached: AppDb | null | undefined;

/**
 * Lazy Drizzle client. Returns null when DATABASE_URL is unset (tests / build
 * without Neon). Prefer `requireDb()` in authenticated sync/admin paths.
 */
export function getDb(): AppDb | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    cached = null;
    return cached;
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}

export function requireDb(): AppDb {
  const db = getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL is not configured. Set it to the Neon EU (aws-eu-central-1) pooled connection string.",
    );
  }
  return db;
}

/** Test-only — clear the cached client between suites. */
export function _resetDbForTests(): void {
  cached = undefined;
}
