/**
 * A real Postgres (PGlite, Postgres compiled to WASM) with this app's own migrations applied.
 *
 * For SQL that a mock cannot check: jsonb expressions, conditional UPDATEs. A mocked
 * `db.update()` proves only that the call was made, never that the statement does what its
 * comment says. Runs in-process and in memory — no server, no network, no Neon traffic.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";

export async function freshDb() {
  const client = new PGlite();
  // The migrations are hand-written multi-statement files (BEGIN ... COMMIT), so they are
  // applied as scripts, in file order, exactly as they were run against Neon.
  const dir = path.resolve(__dirname, "../../drizzle");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    await client.exec(readFileSync(path.join(dir, f), "utf8"));
  }
  const db = drizzle(client, { schema });
  return { db, client };
}
