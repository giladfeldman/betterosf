import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

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

// <website-upgrade:schema-end>
