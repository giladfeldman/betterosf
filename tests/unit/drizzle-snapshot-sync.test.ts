/**
 * Backlog item (todo.md, 2026-08-04): "`drizzle/meta` snapshot is out of sync
 * with the live schema. `0001_email_events.sql` was applied by hand and never
 * made it into the snapshot, which is why drizzle-kit regenerated it."
 *
 * The consequence was concrete and dangerous: `npx drizzle-kit generate` emitted
 * a migration containing `CREATE TABLE email_events` — a table that already
 * exists in production. Running that generated file verbatim would have FAILED
 * against the live database. The only reason it didn't cause an incident is that
 * the SQL was read before being run.
 *
 * A stale snapshot is a silent trap for whoever touches the schema next, so this
 * pins the structural invariants that keep the generator honest:
 *  - every migration has exactly one matching snapshot,
 *  - the snapshot chain (prevId → id) is unbroken,
 *  - the newest snapshot contains every table the app's schema declares.
 *
 * These are checkable offline; the live-database comparison needs credentials
 * and is done manually (see the migration header in 0002_bug_reports.sql).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const metaDir = resolve(root, "drizzle/meta");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;

type Journal = { entries: Array<{ idx: number; tag: string }> };
const journal = readJson(resolve(metaDir, "_journal.json")) as unknown as Journal;

type Snapshot = { id: string; prevId: string; tables: Record<string, unknown> };
function snapshot(idx: number): Snapshot {
  return readJson(resolve(metaDir, `${String(idx).padStart(4, "0")}_snapshot.json`)) as unknown as Snapshot;
}

describe("drizzle migration bookkeeping", () => {
  it("has a .sql file for every journal entry", () => {
    for (const e of journal.entries) {
      expect(existsSync(resolve(root, "drizzle", `${e.tag}.sql`)), `missing ${e.tag}.sql`).toBe(true);
    }
  });

  it("has exactly one snapshot per journal entry", () => {
    const snapshots = readdirSync(metaDir).filter((f) => f.endsWith("_snapshot.json"));
    expect(snapshots).toHaveLength(journal.entries.length);
    for (const e of journal.entries) {
      const name = `${String(e.idx).padStart(4, "0")}_snapshot.json`;
      expect(snapshots, `missing snapshot for idx ${e.idx}`).toContain(name);
    }
  });

  it("has journal indices that are sequential from zero", () => {
    const idxs = journal.entries.map((e) => e.idx);
    expect(idxs).toEqual(idxs.map((_, i) => i));
  });

  it("has an unbroken snapshot chain (each prevId points at the previous id)", () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = snapshot(i - 1);
      const cur = snapshot(i);
      expect(cur.prevId, `snapshot ${i} does not follow ${i - 1}`).toBe(prev.id);
    }
  });

  it("declares every table the app schema defines in the newest snapshot", () => {
    // If schema.ts gains a pgTable and no migration follows, this catches it —
    // the exact drift that made drizzle-kit regenerate an applied migration.
    const schema = readFileSync(resolve(root, "src/lib/db/schema.ts"), "utf8");
    const declared = [...schema.matchAll(/pgTable\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);

    const latest = snapshot(journal.entries.length - 1);
    const inSnapshot = Object.keys(latest.tables).map((t) => t.replace(/^public\./, ""));
    for (const table of declared) {
      expect(inSnapshot, `table "${table}" is in schema.ts but not in the latest snapshot`).toContain(table);
    }
  });

  it("keeps bug_reports out of the pre-bug_reports snapshot (chain is meaningful)", () => {
    // A snapshot chain where every entry is identical would pass the checks
    // above while telling drizzle nothing. This asserts the history is real.
    const before = Object.keys(snapshot(1).tables);
    const after = Object.keys(snapshot(2).tables);
    expect(before).not.toContain("public.bug_reports");
    expect(after).toContain("public.bug_reports");
  });
});
