import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
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

// <website-upgrade:schema-end>
