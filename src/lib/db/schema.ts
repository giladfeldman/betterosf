import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * App users keyed by OSF subject id. Sessions stay JWT (OSF tokens in cookie);
 * this table is for prefs, bookmarks, admin logs — not Auth.js adapter sessions.
 */
export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    osfUserId: text("osf_user_id").notNull(),
    name: text("name"),
    email: text("email"),
    image: text("image"),
    role: text("role").notNull().default("user"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_osf_user_id_uidx").on(t.osfUserId)],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refId: text("ref_id").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bookmarks_user_ref_uidx").on(t.userId, t.refId),
    index("bookmarks_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Arbitrary JSON prefs bag (page sizes, split panes, tree state, …). */
export const userPrefs = pgTable("user_prefs", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const systemLogs = pgTable(
  "system_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    level: text("level").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    requestId: text("request_id"),
  },
  (t) => [
    index("system_logs_type_created_idx").on(t.type, t.createdAt),
    index("system_logs_level_created_idx").on(t.level, t.createdAt),
    index("system_logs_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const emailEvents = pgTable(
  "email_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    type: text("type").notNull(),
    bounceType: text("bounce_type"),
    messageId: text("message_id"),
    reason: text("reason"),
    payload: jsonb("payload"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_events_email_idx").on(t.email),
    index("email_events_type_idx").on(t.type),
    // Partial unique — ON CONFLICT must use argument-less .onConflictDoNothing().
    uniqueIndex("email_events_idempotency_key_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

/**
 * User-submitted bug reports and feedback.
 *
 * Anonymous submission is allowed on purpose: BetterOSF's primary audience
 * browses OSF signed-out, and requiring a login to report a broken page would
 * lose exactly the reports we most need. `userId` is therefore nullable, and
 * `contactEmail` is optional — a report with neither is still worth storing.
 */
export const bugReports = pgTable(
  "bug_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** "bug" | "idea" | "question" — what the reporter said it was. */
    kind: text("kind").notNull().default("bug"),
    message: text("message").notNull(),
    /** Optional reply-to address supplied by the reporter. */
    contactEmail: text("contact_email"),
    /** Page the reporter was on — the highest-signal field after the message. */
    pageUrl: text("page_url"),
    /** App version, so a report is always tied to a specific build. */
    appVersion: text("app_version"),
    userAgent: text("user_agent"),
    /** Signed-in reporter, when there is one. Survives user deletion as null. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    osfUserId: text("osf_user_id"),
    /** "new" | "triaged" | "resolved" — admin workflow state. */
    status: text("status").notNull().default("new"),
    adminNotes: text("admin_notes"),
  },
  (t) => [
    index("bug_reports_created_idx").on(t.createdAt),
    index("bug_reports_status_created_idx").on(t.status, t.createdAt),
  ],
);

/**
 * Evidence of agreement to the OSF Transition Toolkit terms.
 *
 * Only this one transition table exists so far, on purpose. The inventory, job, and
 * per-file tables land with the features that actually populate them — a declared
 * column no code writes is a promise to every future reader that the data is there.
 *
 * `userId` is nullable with `set null` and `osfUserId` is retained separately, matching
 * `bug_reports`: a consent record whose subject was deleted still has to be readable as
 * evidence, and cascading it away would destroy exactly the artifact it exists to be.
 */
export const transitionConsents = pgTable(
  "transition_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nulled rather than deleted if the app user row goes away. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Durable identity of who agreed, independent of our own user table. */
    osfUserId: text("osf_user_id").notNull(),
    /** Exact TERMS_VERSION agreed to. Matched exactly — never "same or newer". */
    termsVersion: text("terms_version").notNull(),
    /** "toolkit" | "job" | "publish" — see src/lib/transition/consent.ts. */
    scope: text("scope").notNull(),
    /** Set for job- and publish-scoped consents; null for the toolkit clickwrap. */
    jobId: text("job_id"),
    /** The phrase actually typed, for publish scope. Evidence, so stored verbatim. */
    typedPhrase: text("typed_phrase"),
    /** The count the user was shown and had to type. Null outside publish scope. */
    itemCount: integer("item_count"),
    userAgent: text("user_agent"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transition_consents_osf_user_idx").on(t.osfUserId, t.acceptedAt),
    index("transition_consents_scope_idx").on(t.osfUserId, t.scope, t.termsVersion),
  ],
);

/**
 * Coarse checkpoints for a transfer run.
 *
 * **IndexedDB is the primary ledger; this is the checkpoint.** A run writes every file
 * result to the browser as it goes, and pushes a batch here roughly every 25 files or
 * 30 seconds. That split is a cost decision the standing "no paid tiers, no meaningful
 * Vercel usage" rule forces, and it is also the honest one: the browser is where the run
 * actually is, so the browser is where its state belongs. This table exists so a run can
 * be found again from another device, and so the evidence of what was verified survives
 * a browser that clears its storage.
 *
 * `records` deliberately holds only `{recordId, fileCount}` per shard — never the file
 * paths. Shard assignment is recomputed deterministically by `planShards`, and writing
 * five thousand paths into a jsonb column on every checkpoint would be both wasteful and
 * a second copy of the truth.
 */
export const transitionJobs = pgTable(
  "transition_jobs",
  {
    /** Client-generated so the browser can start a run before it can reach the server. */
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    osfUserId: text("osf_user_id").notNull(),
    /** OSF project this run is copying. */
    guid: text("guid").notNull(),
    /** "zenodo" today. Named rather than assumed, so a second target cannot be silent. */
    destination: text("destination").notNull(),
    /** "sandbox" | "production" — a sandbox deposit is wipeable and mints no real DOI. */
    env: text("env").notNull(),
    /** "running" | "complete" | "incomplete" | "abandoned". Set from reconcile()'s verdict. */
    status: text("status").notNull(),
    records: jsonb("records").$type<{ recordId: string; fileCount: number }[]>().notNull().default([]),
    /**
     * Records this run has already published, written ONLY by the publish route and never
     * by a client checkpoint — which is why it is a separate column from `records` rather
     * than a field inside it. Publishing mints a permanent DOI, so a replayed request must
     * be refused by us rather than by whatever Zenodo happens to do about it, which this
     * codebase has never measured.
     * (Sonnet consult 2026-08-13.)
     */
    publishedRecords: jsonb("published_records")
      .$type<{ recordId: string; doi: string | null; publishedAt: string }[]>()
      .notNull()
      .default([]),
    fileCount: integer("file_count").notNull().default(0),
    bytesTotal: bigint("bytes_total", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transition_jobs_user_updated_idx").on(t.osfUserId, t.updatedAt)],
);

/**
 * Per-file evidence for a transfer run.
 *
 * One row per file, upserted on `(job_id, osf_file_id)` — bound by OSF's immutable file
 * id, never by path, the same rule the verifier follows.
 *
 * Both checksums are kept because a resumed run RE-TESTS them against what the destination
 * reports at the time it resumes. A stored "this was verified" that is never re-checked
 * would be a memory presented as a measurement.
 */
export const transitionItems = pgTable(
  "transition_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: text("job_id")
      .notNull()
      .references(() => transitionJobs.id, { onDelete: "cascade" }),
    /** Denormalised so an item row can be authorised without a join. */
    osfUserId: text("osf_user_id").notNull(),
    osfFileId: text("osf_file_id").notNull(),
    path: text("path").notNull(),
    size: bigint("size", { mode: "number" }).notNull().default(0),
    /** "verified" | "unverifiable" | "failed" — verify.ts's VerificationState, verbatim. */
    state: text("state").notNull(),
    localSha256: text("local_sha256"),
    localMd5: text("local_md5"),
    /** What the destination said it stored. Null is a real answer: "it told us nothing". */
    remoteMd5: text("remote_md5"),
    shardIndex: integer("shard_index").notNull().default(0),
    problems: jsonb("problems").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transition_items_job_file_uidx").on(t.jobId, t.osfFileId),
    index("transition_items_job_idx").on(t.jobId),
  ],
);

// <website-upgrade:schema-end>
